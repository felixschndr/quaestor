import asyncio
from datetime import datetime

from source.backend.db import SessionLocal
from source.backend.helpers import seconds_until_next_midnight
from source.backend.logging_utils import get_logger
from source.backend.services import notification_engine

logger = get_logger(__name__)


def _evaluate_overdue_contracts() -> None:
    with SessionLocal() as db_session:
        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=datetime.now().date())


async def run_periodic_overdue_check() -> None:
    while True:
        try:
            await asyncio.to_thread(_evaluate_overdue_contracts)
        except Exception as e:
            logger.exception(message="Overdue contract check run crashed", exc_info=e)
        await asyncio.sleep(seconds_until_next_midnight())
