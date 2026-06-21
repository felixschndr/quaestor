import asyncio
import os
from datetime import timedelta

from source.backend.db import SessionLocal
from source.backend.logging_utils import get_logger
from source.backend.services import credential_service

logger = get_logger(__name__)

SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME = "SYNC_INTERVAL_HOURS"
DEFAULT_SYNC_INTERVAL = timedelta(hours=12)


def _sync_interval() -> timedelta:
    raw = os.environ.get(SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME)
    if raw is None:
        return DEFAULT_SYNC_INTERVAL
    try:
        return timedelta(hours=float(raw))
    except ValueError:
        logger.warning(
            f"Invalid {SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME}={raw!r}; falling back to {DEFAULT_SYNC_INTERVAL}"
        )
        return DEFAULT_SYNC_INTERVAL


def sync_interval_hours() -> float:
    return _sync_interval().total_seconds() / 3600


def _sync_all_due_credentials() -> None:
    with SessionLocal() as db_session:
        credential_service.sync_all_due_credentials(db_session)


async def run_periodic_sync() -> None:
    interval = _sync_interval()
    logger.info(f"Periodic credential sync scheduled every {interval}")
    while True:
        await asyncio.sleep(interval.total_seconds())
        try:
            # The sync is blocking (HTTP/FinTS clients), so keep it off the event loop.
            await asyncio.to_thread(_sync_all_due_credentials)
        except Exception as e:
            logger.exception(message="Periodic credential sync run crashed", exc_info=e)
