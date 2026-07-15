import asyncio
import json
import time
from datetime import timedelta

from source.backend.bank_handlers.enable_banking_handler import API_BASE
from source.backend.helpers import RestAPIClient
from source.backend.logging_utils import get_logger
from source.backend.paths import ENABLE_BANKING_ASPSPS_PATH
from source.backend.services.banking import bank_catalog

logger = get_logger(__name__)

MAX_AGE = timedelta(days=7)

_aspsps: list[dict] = []


def get_aspsps() -> list[dict]:
    return _aspsps


def _is_fresh_enough() -> bool:
    path = ENABLE_BANKING_ASPSPS_PATH
    return path.exists() and time.time() - path.stat().st_mtime < MAX_AGE.total_seconds()


def _load_cached() -> list[dict]:
    if not ENABLE_BANKING_ASPSPS_PATH.exists():
        return []
    try:
        return json.loads(ENABLE_BANKING_ASPSPS_PATH.read_text())
    except (OSError, ValueError):
        logger.warning("Cached Enable Banking ASPSP list is unreadable; ignoring it")
        return []


def _update() -> None:
    global _aspsps
    if _is_fresh_enough():
        logger.info("Enable Banking ASPSP list is fresh enough; skipping update")
        _aspsps = _load_cached()
        return

    fetched = RestAPIClient(name="Enable Banking", base_url=API_BASE).get("/api/aspsps")["aspsps"]
    if not fetched:
        logger.warning("Enable Banking ASPSP list came back empty; keeping the cached list")
        _aspsps = _load_cached()
        return

    ENABLE_BANKING_ASPSPS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENABLE_BANKING_ASPSPS_PATH.write_text(json.dumps(fetched))
    _aspsps = fetched
    logger.info(f"Enable Banking ASPSP list updated: {len(fetched)} banks")


async def run_startup_update() -> None:
    try:
        await asyncio.to_thread(_update)
    except Exception as e:
        logger.exception(message="Enable Banking ASPSP update failed; using cached list", exc_info=e)
        global _aspsps
        _aspsps = _load_cached()
    bank_catalog.invalidate_catalog_cache()
