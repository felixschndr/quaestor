from datetime import date

from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import (
    AccountNotFoundError,
    PermissionDeniedError,
    TransactionNotFoundError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from sqlalchemy import func, select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


def _require_manual_account(account: Account) -> None:
    if account.credential.bank != BankProvider.MANUAL:
        raise PermissionDeniedError(
            f"This endpoint is only available for accounts on a manual credential; "
            f"{account} belongs to {account.credential.bank.value}"
        )


DEFAULT_DAYS_PER_PAGE = 30
MAX_DAYS_PER_PAGE = 365


def list_accounts(db_session: Session, user_id: int) -> list[Account]:
    stmt = (
        select(Account)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user_id)
    )
    accounts = list(db_session.scalars(stmt))
    logger.debug(f"Found {len(accounts)} account(s) for user {user_id}")
    return accounts


def get_account(db_session: Session, account_id: int) -> Account:
    account = db_session.get(entity=Account, ident=account_id)
    if account is None:
        error_message = f"Account with the ID {account_id} not found"
        logger.warning(error_message)
        raise AccountNotFoundError(error_message)
    logger.debug(f"Loaded {account}")
    return account


def get_account_for_user(db_session: Session, account_id: int, user_id: int) -> Account:
    account = get_account(db_session=db_session, account_id=account_id)
    if account.credential.user_id != user_id:
        logger.warning(f"User {user_id} attempted to access {account} owned by user {account.credential.user_id}")
        raise AccountNotFoundError(f"Account with the ID {account_id} not found")
    return account


def get_transaction_for_account(db_session: Session, account: Account, transaction_id: int) -> Transaction:
    not_found_error = TransactionNotFoundError(f"Transaction with the ID {transaction_id} not found")
    transaction = db_session.get(entity=Transaction, ident=transaction_id)
    if transaction is None:
        logger.warning(f"Transaction with the ID {transaction_id} not found")
        raise not_found_error
    if transaction.account_id != account.id:
        logger.warning(f"{transaction} does not belong to {account}")
        raise not_found_error
    logger.debug(f"Loaded {transaction}")
    return transaction


def update_transaction(db_session: Session, transaction: Transaction, fields: dict) -> Transaction:
    previous_category = transaction.category
    transaction_before_change = str(transaction)
    for key, value in fields.items():
        setattr(transaction, key, value)
    db_session.commit()
    logger.info(f"Updated transaction {transaction_before_change} --> {transaction}")
    if "category" in fields and fields["category"] != previous_category:
        logger.info(
            f"Category override on {transaction}: previous={previous_category.value} new={transaction.category.value}"
        )
    return transaction


def update_account(db_session: Session, account: Account, fields: dict) -> Account:
    # `balance_factor` is non-nullable; an explicit `null` in the PATCH body
    # is treated as "no change" so the request doesn't 500 at commit time.
    # `display_name` (nullable) keeps its explicit-null semantics (= clear).
    if fields.get("balance_factor") is None:
        fields.pop("balance_factor", None)

    balance_in_payload = "balance" in fields
    if balance_in_payload:
        _require_manual_account(account)
        if fields.get("balance") is None:
            fields.pop("balance")
            balance_in_payload = False
    account_before_change = str(account)
    for key, value in fields.items():
        setattr(account, key, value)
    if balance_in_payload:
        account.recompute_balances_at_date()
    db_session.commit()
    logger.info(f"Updated account {account_before_change} --> {account}")
    return account


def create_manual_account(
    db_session: Session,
    user_id: int,
    credential_id: int,
    name: str,
    display_name: str | None,
    balance: float,
    balance_factor: int,
) -> Account:
    credential = db_session.get(entity=Credential, ident=credential_id)
    if credential is None or credential.user_id != user_id:
        logger.warning(f"User {user_id} attempted to create an account on unknown / foreign credential {credential_id}")
        raise AccountNotFoundError(f"Credential with the ID {credential_id} not found")
    if credential.bank != BankProvider.MANUAL:
        raise PermissionDeniedError(
            f"Accounts can only be created manually on a 'manual' credential; "
            f"credential {credential_id} belongs to {credential.bank.value}"
        )
    account = Account(
        credential=credential,
        name=name,
        display_name=display_name,
        balance=balance,
        balance_factor=balance_factor,
    )
    db_session.add(account)
    db_session.commit()
    logger.info(f"Created manual {account}")
    return account


def delete_account(db_session: Session, account: Account) -> None:
    _require_manual_account(account)
    db_session.delete(account)
    db_session.commit()
    logger.info(f"Deleted manual {account}")


def create_manual_transaction(db_session: Session, account: Account, fields: dict) -> Transaction:
    _require_manual_account(account)
    transaction = Transaction(
        account=account,
        amount=fields["amount"],
        date=fields["date"],
        purpose=fields.get("purpose"),
        other_party=fields.get("other_party"),
        transaction_type=fields.get("transaction_type"),
        note=fields.get("note"),
    )
    if fields.get("category") is not None:
        transaction.category = fields["category"]
    else:
        transaction.category = TransactionCategory.from_transaction(transaction=transaction)
    account.balance = round(number=account.balance + transaction.amount, ndigits=2)
    db_session.add(transaction)
    db_session.flush()
    account.recompute_balances_at_date()
    db_session.commit()
    logger.info(f"Created manual {transaction} on {account}; new balance {account.balance}")
    return transaction


def delete_transaction(db_session: Session, account: Account, transaction: Transaction) -> None:
    _require_manual_account(account)
    account.balance = round(number=account.balance - transaction.amount, ndigits=2)
    db_session.delete(transaction)
    db_session.flush()
    account.recompute_balances_at_date()
    db_session.commit()
    logger.info(f"Deleted manual {transaction} from {account}; new balance {account.balance}")


def get_history_page(
    db_session: Session,
    account_id: int,
    page: int = 1,
    page_size: int = DEFAULT_DAYS_PER_PAGE,
) -> tuple[list[Transaction], dict[date, float], int]:
    # `page_size` is the number of distinct transaction days per page (not the number of transactions)
    total_days = (
        db_session.scalar(select(func.count(Transaction.date.distinct())).where(Transaction.account_id == account_id))
        or 0
    )
    page_dates = list(
        db_session.scalars(
            select(Transaction.date)
            .where(Transaction.account_id == account_id)
            .group_by(Transaction.date)
            .order_by(Transaction.date.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    if not page_dates:
        logger.debug(f"Account {account_id} history page {page} (size {page_size}): no transactions on this page")
        return [], {}, total_days

    transactions = list(
        db_session.scalars(
            select(Transaction)
            .where(Transaction.account_id == account_id)
            .where(Transaction.date.in_(page_dates))
            .order_by(Transaction.date.desc())
            .order_by(Transaction.id.desc())
        )
    )
    snapshots = db_session.scalars(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .where(AccountBalanceSnapshot.date.in_(page_dates))
    )
    balance_at_date = {snapshot.date: snapshot.balance for snapshot in snapshots}
    logger.debug(
        f"Account {account_id} history page {page} (size {page_size}): "
        f"{len(page_dates)} day(s), {len(transactions)} transaction(s) of {total_days} total day(s)"
    )
    return transactions, balance_at_date, total_days


def get_filtered_transactions_for_user(
    db_session: Session,
    user_id: int,
    account_ids_to_search_through: list[int],
    filter_parameters: dict,
) -> list[Transaction]:
    if not account_ids_to_search_through:
        return []
    owned_account_ids = {
        account.id
        for account in db_session.scalars(
            select(Account)
            .join(Credential, onclause=Account.credential_id == Credential.id)
            .where(Credential.user_id == user_id)
            .where(Account.id.in_(account_ids_to_search_through))
        )
    }
    unknown_account_ids = set(account_ids_to_search_through) - owned_account_ids
    if unknown_account_ids:
        logger.warning(f"User {user_id} attempted to search accounts they don't own: {sorted(unknown_account_ids)}")
        raise AccountNotFoundError(f"Account(s) {sorted(unknown_account_ids)} not found")
    return _filter_transactions(
        db_session=db_session, account_ids=list(owned_account_ids), filter_parameters=filter_parameters
    )


def _filter_transactions(db_session: Session, account_ids: list[int], filter_parameters: dict) -> list[Transaction]:
    query = select(Transaction).where(Transaction.account_id.in_(account_ids))

    if (text := filter_parameters.get("text")) is not None:
        pattern = f"%{text}%"
        query = query.where(
            Transaction.purpose.ilike(pattern)
            | Transaction.other_party.ilike(pattern)
            | Transaction.note.ilike(pattern)
        )

    if (amount_from := filter_parameters.get("amount_from")) is not None:
        query = query.where(Transaction.amount >= amount_from)
    if (amount_to := filter_parameters.get("amount_to")) is not None:
        query = query.where(Transaction.amount <= amount_to)

    if (date_from := filter_parameters.get("date_from")) is not None:
        query = query.where(Transaction.date >= date_from)
    if (date_to := filter_parameters.get("date_to")) is not None:
        query = query.where(Transaction.date <= date_to)

    if transaction_type := filter_parameters.get("transaction_type"):
        query = query.where(Transaction.transaction_type == transaction_type)
    if category := filter_parameters.get("category"):
        query = query.where(Transaction.category == category)

    if note := filter_parameters.get("note"):
        query = query.where(Transaction.note.ilike(f"%{note}%"))

    transactions = list(db_session.execute(query).scalars())
    logger.debug(f"Filtered {len(transactions)} transaction(s) across accounts {account_ids} with {filter_parameters}")
    return transactions
