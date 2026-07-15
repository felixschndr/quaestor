import asyncio
import json

from source.backend.logging_utils import get_logger
from source.backend.paths import ENABLE_BANKING_ASPSPS_PATH
from source.backend.rest_api_client import RestAPIClient
from source.backend.services.banking import bank_catalog

logger = get_logger(__name__)

_CATALOG_BASE_URL = "https://enablebanking.com"

_aspsps: list[dict] = []


def get_aspsps() -> list[dict]:
    global _aspsps
    if not _aspsps:
        _aspsps = _load_cached()
    if not _aspsps:
        try:
            _aspsps = _fetch()
        except Exception as e:
            logger.exception(message="Enable Banking ASPSP fetch failed; the catalog will not contain them", exc_info=e)
    return _aspsps


def _load_cached() -> list[dict]:
    if not ENABLE_BANKING_ASPSPS_PATH.exists():
        return []
    try:
        return json.loads(ENABLE_BANKING_ASPSPS_PATH.read_text())
    except (OSError, ValueError):
        logger.warning("Cached Enable Banking ASPSP list is unreadable; ignoring it")
        return []


def _fetch() -> list[dict]:
    logger.info("Fetching bank ASPSP list")
    fetched = RestAPIClient(name="Enable Banking", base_url=_CATALOG_BASE_URL).get("/api/aspsps")["aspsps"]
    if not fetched:
        logger.warning("Enable Banking ASPSP list came back empty")
        return []
    ENABLE_BANKING_ASPSPS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ENABLE_BANKING_ASPSPS_PATH.write_text(json.dumps(fetched))
    logger.info(f"Enable Banking ASPSP list updated: {len(fetched)} banks")
    return fetched


async def run_startup_update() -> None:
    global _aspsps
    try:
        _aspsps = await asyncio.to_thread(_fetch) or _load_cached()
    except Exception as e:
        logger.exception(message="Enable Banking ASPSP update failed; using cached list", exc_info=e)
        _aspsps = _load_cached()
    bank_catalog.invalidate_catalog_cache()
