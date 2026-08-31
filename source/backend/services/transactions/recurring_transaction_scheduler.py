from source.backend.db import SessionLocal
from source.backend.helpers import run_daily
from source.backend.services.transactions import recurring_transaction_service


def _book_due_recurring_transactions() -> None:
    with SessionLocal() as db_session:
        recurring_transaction_service.book_due_recurring_transactions(db_session)


async def run_periodic_recurring() -> None:
    await run_daily(job=_book_due_recurring_transactions, error_message="Recurring transaction booking run crashed")
