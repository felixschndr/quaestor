import asyncio

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.db import SessionLocal
from source.backend.helpers import format_transaction_for_categorization
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.transactions.category_source import CategorySource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory

logger = get_logger(__name__)

BATCH_SIZE = 500


def rescan_categories_sync() -> None:
    with SessionLocal() as db_session:
        logger.info(f"Starting re-scan of transactions categorised {CategorySource.AUTO.value}")
        for user in db_session.scalars(select(User)).all():
            recategorize_user_transactions(db_session=db_session, user=user)
        db_session.commit()


def recategorize_user_transactions(db_session: Session, user: User) -> int:
    rules = user.categorization_rules
    updated = 0
    stmt = (
        select(Transaction)
        .join(Account, onclause=Transaction.account_id == Account.id)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
        .where(Transaction.category_source == CategorySource.AUTO)
        .execution_options(yield_per=BATCH_SIZE)
    )
    for transaction in db_session.scalars(stmt):
        new_category = TransactionCategory.from_transaction(transaction=transaction, rules=rules, log_result=False)
        if new_category != transaction.category:
            logger.info(
                f"Re-scanned {format_transaction_for_categorization(transaction)} "
                f"from {transaction.category} to {new_category}"
            )
            transaction.category = new_category
            updated += 1
    logger.info(f"Re-derived the categories of {updated} transaction(s) of {user}")
    return updated


async def run_startup_rescan() -> None:
    try:
        await asyncio.to_thread(rescan_categories_sync)
    except Exception:
        logger.exception(message="Startup category re-scan crashed")
