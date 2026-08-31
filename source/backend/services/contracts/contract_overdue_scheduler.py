from datetime import datetime

from source.backend.db import SessionLocal
from source.backend.helpers import run_daily
from source.backend.services.notifications import notification_engine


def _evaluate_overdue_contracts() -> None:
    with SessionLocal() as db_session:
        today = datetime.now().date()
        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=today)
        notification_engine.evaluate_ending_contracts(db_session=db_session, today=today)


async def run_periodic_overdue_check() -> None:
    await run_daily(job=_evaluate_overdue_contracts, error_message="Overdue contract check run crashed")
