import asyncio
from datetime import datetime, time, timedelta

from source.backend.db import SessionLocal
from source.backend.logging_utils import get_logger
from source.backend.services import recurring_transaction_service

logger = get_logger(__name__)


def _seconds_until_next_midnight() -> float:
    now = datetime.now()
    next_midnight = datetime.combine(date=now.date() + timedelta(days=1), time=time.min)
    return (next_midnight - now).total_seconds()


def _book_due_recurring_transactions() -> None:
    with SessionLocal() as db_session:
        recurring_transaction_service.book_due_recurring_transactions(db_session)


async def run_periodic_recurring() -> None:
    logger.info("Recurring transaction booking scheduled daily, just after midnight")
    while True:
        # Run to catch occurrences missed while the app was down.
        try:
            await asyncio.to_thread(_book_due_recurring_transactions)
        except Exception as e:
            logger.exception(message="Recurring transaction booking run crashed", exc_info=e)
        await asyncio.sleep(_seconds_until_next_midnight())
