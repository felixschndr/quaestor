from datetime import datetime

from source.backend.db import SessionLocal
from source.backend.helpers import run_daily
from source.backend.services.notifications import notification_engine


def _evaluate_digests() -> None:
    with SessionLocal() as db_session:
        notification_engine.evaluate_digests(db_session=db_session, today=datetime.now().date())


async def run_periodic_digest() -> None:
    await run_daily(job=_evaluate_digests, error_message="Digest run crashed")
