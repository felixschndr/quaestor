from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import (
    AccountNotFoundError,
    ConflictError,
    ExpectedTransactionNotFoundError,
    PermissionDeniedError,
    TransactionNotFoundError,
    ValidationError,
)
from source.backend.helpers import apply_fields
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_balance_snapshot import (
    AccountBalanceSnapshot,
)
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.base import snapshot_columns
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType

logger = get_logger(__name__)


def _is_manual_account(account: Account) -> bool:
    return account.credential.bank == BankProvider.MANUAL


def _require_manual_account(account: Account) -> None:
    if not _is_manual_account(account):
        raise PermissionDeniedError(
            f"This endpoint is only available for accounts on a manual credential; "
            f"{account} belongs to {account.credential.bank.value}"
        )


def _require_synced_account(account: Account) -> None:
    if _is_manual_account(account):
        raise PermissionDeniedError(
            f"This endpoint is only available for accounts for synced accounts; "
            f"{account} belongs to a manual credential"
        )


DEFAULT_DAYS_PER_PAGE = 30
MAX_DAYS_PER_PAGE = 365


def list_accounts(db_session: Session, user: User) -> list[Account]:
    stmt = (
        select(Account)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
    )
    accounts = list(db_session.scalars(stmt))
    logger.debug(f"Found {len(accounts)} account(s) for {user}")
    return accounts


def get_account(db_session: Session, account_id: int) -> Account:
    account = db_session.get(entity=Account, ident=account_id)
    if account is None:
        error_message = f"Account with the ID {account_id} not found"
        logger.warning(error_message)
        raise AccountNotFoundError(error_message)
    logger.debug(f"Loaded {account}")
    return account


def get_account_for_user(db_session: Session, account_id: int, user: User) -> Account:
    account = get_account(db_session=db_session, account_id=account_id)
    if account.credential.user_id != user.id:
        logger.warning(f"{user} attempted to access {account} owned by user {account.credential.user_id}")
        raise AccountNotFoundError(f"Account with the ID {account_id} not found")
    logger.debug(f"{user} accessed {account}")
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


def update_transaction(db_session: Session, account: Account, transaction: Transaction, fields: dict) -> Transaction:
    if transaction.pending:
        # Pending entries are provisional previews
        # They're wiped and re-fetched on every sync, so any edit would be lost.
        raise ValidationError(f"{transaction} is pending and cannot be edited")
    manual_only = Transaction.FIELDS_THAT_ARE_ONLY_EDITABLE_ON_MANUAL_ACCOUNTS & set(fields)
    if manual_only:
        _require_manual_account(account)
    if "date" in fields:
        _reject_future_date(fields["date"])

    previous_amount = transaction.amount
    previous_date = transaction.date
    state_before_update = snapshot_columns(transaction)
    apply_fields(entity=transaction, fields=fields)

    amount_changed = "amount" in fields and transaction.amount != previous_amount
    date_changed = "date" in fields and transaction.date != previous_date
    if amount_changed:
        account.balance = round(number=account.balance + (transaction.amount - previous_amount), ndigits=2)
    if amount_changed or date_changed:
        db_session.flush()
        account.recompute_balances_at_date()

    db_session.commit()
    logger.update(state_before_update=state_before_update, entity_after_update=transaction)
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
    state_before_update = snapshot_columns(account)
    apply_fields(entity=account, fields=fields)
    if balance_in_payload:
        account.recompute_balances_at_date()
    db_session.commit()
    logger.update(state_before_update=state_before_update, entity_after_update=account)
    return account


def create_manual_account(
    db_session: Session,
    credential: Credential,
    name: str,
    display_name: str | None,
    balance: float,
    balance_factor: float,
) -> Account:
    if credential.bank != BankProvider.MANUAL:
        raise PermissionDeniedError(
            f"Accounts can only be created manually on a 'manual' credential; "
            f"{credential} belongs to {credential.bank.value}"
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
    logger.info(f"Created manual {account} on {credential}")
    return account


def delete_account(db_session: Session, account: Account) -> None:
    _require_manual_account(account)

    parent_credential = account.credential
    siblings_left = sum(1 for sibling in parent_credential.accounts if sibling.id != account.id)
    db_session.delete(account)
    if siblings_left == 0:
        db_session.delete(parent_credential)
        logger.info(f"Deleted last manual account on {parent_credential}; deleted the credential too")

    db_session.commit()
    logger.info(f"Deleted manual {account}")


def _reject_future_date(value: date) -> None:
    # Manual transactions can't be future-dated: account.balance is maintained as
    # a running sum and we don't have a scheduler that rolls future txns in once
    # their date arrives, so a future txn here would inflate today's balance.
    if value > date.today():
        raise ValidationError(f"Manual transactions cannot have a future date (got {value.isoformat()})")


def create_manual_transaction(
    db_session: Session, account: Account, fields: dict, recurring_transaction_id: int | None = None
) -> Transaction:
    _require_manual_account(account)
    _reject_future_date(fields["date"])
    transaction = Transaction(
        account=account,
        amount=fields["amount"],
        date=fields["date"],
        purpose=fields.get("purpose"),
        other_party=fields.get("other_party"),
        transaction_type=fields.get("transaction_type"),
        note=fields.get("note"),
        recurring_transaction_id=recurring_transaction_id,
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


def create_expected_transaction(db_session: Session, account: Account, fields: dict) -> Transaction:
    _require_synced_account(account)
    # Anchored at the creation day: the matching pass only resolves bookings dated on or after this,
    # and there is deliberately no user-facing "expected from" date.
    transaction = Transaction(
        account=account,
        amount=fields["amount"],
        date=date.today(),
        other_party=fields.get("other_party"),
        note=fields.get("note"),
        match_tolerance_percent=fields.get("match_tolerance_percent", 0),  # noqa: FKA100
        pending=True,
        expected=True,
        category=TransactionCategory.UNKNOWN,
    )
    db_session.add(transaction)
    db_session.commit()
    logger.info(f"Created expected {transaction}")
    return transaction


def list_expected_transactions(db_session: Session, account: Account) -> list[Transaction]:
    transactions = list(
        db_session.scalars(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.expected.is_(True))
            .order_by(Transaction.id.desc())
        )
    )
    logger.debug(f"Found {len(transactions)} expected transaction(s) for {account}")
    return transactions


def _get_expected_transaction_for_account(
    db_session: Session, account: Account, expected_transaction_id: int
) -> Transaction:
    transaction = db_session.get(entity=Transaction, ident=expected_transaction_id)
    if transaction is None or transaction.account_id != account.id or not transaction.expected:
        logger.warning(f"Expected transaction {expected_transaction_id} not found for {account}")
        raise ExpectedTransactionNotFoundError(f"Expected transaction with the ID {expected_transaction_id} not found")
    return transaction


def update_expected_transaction(
    db_session: Session, account: Account, expected_transaction_id: int, fields: dict
) -> Transaction:
    transaction = _get_expected_transaction_for_account(
        db_session=db_session, account=account, expected_transaction_id=expected_transaction_id
    )
    state_before_update = snapshot_columns(transaction)
    transaction.amount = fields["amount"]
    transaction.other_party = fields.get("other_party")
    transaction.note = fields.get("note")
    transaction.match_tolerance_percent = fields.get("match_tolerance_percent", 0)  # noqa: FKA100
    db_session.commit()
    logger.update(state_before_update=state_before_update, entity_after_update=transaction)
    return transaction


def delete_expected_transaction(db_session: Session, account: Account, expected_transaction_id: int) -> None:
    transaction = _get_expected_transaction_for_account(
        db_session=db_session, account=account, expected_transaction_id=expected_transaction_id
    )
    db_session.delete(transaction)
    db_session.commit()
    logger.info(f"Deleted expected transaction {expected_transaction_id} from {account}")


def link_transactions(db_session: Session, transaction: Transaction, counterpart: Transaction) -> None:
    if transaction.id == counterpart.id:
        raise ValidationError("A transaction cannot be linked to itself")
    if transaction.pending or counterpart.pending:
        raise ValidationError("Pending transactions cannot be linked as transfers")
    if transaction.transfer_counterpart_id is not None or counterpart.transfer_counterpart_id is not None:
        raise ConflictError("Both transactions must be unlinked before they can be linked")

    for leg in (transaction, counterpart):
        leg.transfer_original_type = leg.transaction_type
        leg.transaction_type = TransactionType.TRANSFER_OUT if leg.amount < 0 else TransactionType.TRANSFER_IN
    transaction.transfer_counterpart_id = counterpart.id
    counterpart.transfer_counterpart_id = transaction.id

    db_session.commit()
    logger.info(f"Linked {transaction} to {counterpart}")


def unlink_transactions(db_session: Session, transaction: Transaction) -> None:
    counterpart = None
    if transaction.transfer_counterpart_id is not None:
        counterpart = db_session.get(entity=Transaction, ident=transaction.transfer_counterpart_id)

    for leg in (transaction, counterpart):
        if leg is None:
            continue
        if leg.transfer_original_type is not None:
            leg.transaction_type = leg.transfer_original_type
        leg.transfer_original_type = None
        leg.transfer_counterpart_id = None
        leg.transfer_relink_blocked = True

    db_session.commit()
    logger.info(f"Unlinked Transaction {transaction} from {counterpart}")


def get_history_page(
    db_session: Session,
    account: Account,
    page: int = 1,
    page_size: int = DEFAULT_DAYS_PER_PAGE,
) -> tuple[list[Transaction], dict[date, float], int]:
    # `page_size` is the number of distinct transaction days per page (not the number of transactions).
    # Expected transactions are excluded here — they live in their own section, not the history.
    total_days = (
        db_session.scalar(
            select(func.count(Transaction.date.distinct()))
            .where(Transaction.account_id == account.id)
            .where(Transaction.expected.is_(False))
        )
        or 0
    )
    page_dates = list(
        db_session.scalars(
            select(Transaction.date)
            .where(Transaction.account_id == account.id)
            .where(Transaction.expected.is_(False))
            .group_by(Transaction.date)
            .order_by(Transaction.date.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    if not page_dates:
        logger.debug(f"{account} history page {page} (size {page_size}): no transactions on this page")
        return [], {}, total_days

    transactions = list(
        db_session.scalars(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.expected.is_(False))
            .where(Transaction.date.in_(page_dates))
            .order_by(Transaction.date.desc())
            .order_by(Transaction.id.desc())
        )
    )
    snapshots = db_session.scalars(
        select(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account.id)
        .where(AccountBalanceSnapshot.date.in_(page_dates))
    )
    balance_at_date = {snapshot.date: snapshot.balance for snapshot in snapshots}
    logger.debug(
        f"{account} history page {page} (size {page_size}): "
        f"{len(page_dates)} day(s), {len(transactions)} transaction(s) of {total_days} total day(s)"
    )
    return transactions, balance_at_date, total_days


def resolve_owned_account_ids(db_session: Session, user: User, account_ids: list[int]) -> list[int]:
    if not account_ids:
        return []
    owned_account_ids = {
        account.id
        for account in db_session.scalars(
            select(Account)
            .join(Credential, onclause=Account.credential_id == Credential.id)
            .where(Credential.user_id == user.id)
            .where(Account.id.in_(account_ids))
        )
    }
    unknown_account_ids = set(account_ids) - owned_account_ids
    if unknown_account_ids:
        logger.warning(f"{user} attempted to access accounts they don't own: {sorted(unknown_account_ids)}")
        raise AccountNotFoundError(f"Account(s) {sorted(unknown_account_ids)} not found")
    logger.debug(f"Resolved {len(owned_account_ids)} owned account(s) for {user}")
    return list(owned_account_ids)


def get_filtered_transactions_for_user(
    db_session: Session,
    user: User,
    account_ids_to_search_through: list[int],
    filter_parameters: dict,
) -> list[Transaction]:
    account_ids = resolve_owned_account_ids(db_session=db_session, user=user, account_ids=account_ids_to_search_through)
    if not account_ids:
        return []

    query = select(Transaction).where(Transaction.account_id.in_(account_ids)).where(Transaction.expected.is_(False))

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

    if transaction_types := filter_parameters.get("transaction_types"):
        query = query.where(Transaction.transaction_type.in_(transaction_types))
    if categories := filter_parameters.get("categories"):
        query = query.where(Transaction.category.in_(categories))

    if note := filter_parameters.get("note"):
        query = query.where(Transaction.note.ilike(f"%{note}%"))

    if (linked := filter_parameters.get("linked")) is not None:
        if linked == "linked":
            query = query.where(Transaction.transfer_counterpart_id.isnot(None))
        else:
            query = query.where(Transaction.transfer_counterpart_id.is_(None))

    query = query.order_by(Transaction.date.desc()).order_by(Transaction.id.desc())

    transactions = list(db_session.execute(query).scalars())
    logger.debug(f"Filtered {len(transactions)} transaction(s) across accounts {account_ids} with {filter_parameters}")
    return transactions
