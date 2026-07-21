import asyncio
from datetime import datetime

from source.backend.db import SessionLocal
from source.backend.helpers import seconds_until_next_midnight
from source.backend.logging_utils import get_logger
from source.backend.services.notifications import notification_engine

logger = get_logger(__name__)


def _evaluate_digests() -> None:
    with SessionLocal() as db_session:
        notification_engine.evaluate_digests(db_session=db_session, today=datetime.now().date())


async def run_periodic_digest() -> None:
    while True:
        try:
            await asyncio.to_thread(_evaluate_digests)
        except Exception as e:
            logger.exception(message="Digest run crashed", exc_info=e)
        await asyncio.sleep(seconds_until_next_midnight())
