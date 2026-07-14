import asyncio

from source.backend.db import SessionLocal
from source.backend.helpers import seconds_until_next_midnight
from source.backend.logging_utils import get_logger
from source.backend.services.transactions import recurring_transaction_service

logger = get_logger(__name__)


def _book_due_recurring_transactions() -> None:
    with SessionLocal() as db_session:
        recurring_transaction_service.book_due_recurring_transactions(db_session)


async def run_periodic_recurring() -> None:
    while True:
        # Run to catch occurrences missed while the app was down; then sleep
        try:
            await asyncio.to_thread(_book_due_recurring_transactions)
        except Exception as e:
            logger.exception(message="Recurring transaction booking run crashed", exc_info=e)
        await asyncio.sleep(seconds_until_next_midnight())
