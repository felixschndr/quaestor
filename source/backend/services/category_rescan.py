import asyncio

from source.backend.db import SessionLocal
from source.backend.logging_utils import get_logger
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

BATCH_SIZE = 500


def rescan_unknown_categories_sync() -> None:
    with SessionLocal() as db_session:
        _rescan(db_session=db_session)


def _rescan(db_session: Session) -> None:
    checked = 0
    updated = 0
    stmt = (
        select(Transaction)
        .where(Transaction.category == TransactionCategory.UNKNOWN)
        .execution_options(yield_per=BATCH_SIZE)
    )
    for transaction in db_session.scalars(stmt):
        checked += 1
        new_category = TransactionCategory.from_transaction(transaction=transaction)
        if new_category != TransactionCategory.UNKNOWN:
            transaction.category = new_category
            updated += 1
    db_session.commit()
    logger.info(f"Category re-scan: checked {checked}, updated {updated}, still unknown {checked - updated}")


async def run_startup_rescan() -> None:
    try:
        await asyncio.to_thread(rescan_unknown_categories_sync)
    except Exception as e:
        logger.exception(message="Startup category re-scan crashed", exc_info=e)
