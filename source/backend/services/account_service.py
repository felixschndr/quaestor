from datetime import date

from source.backend.exceptions import AccountNotFoundError, TransactionNotFoundError
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from sqlalchemy import func, select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

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
    account_before_change = str(account)
    for key, value in fields.items():
        setattr(account, key, value)
    db_session.commit()
    logger.info(f"Updated account {account_before_change} --> {account}")
    return account


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
