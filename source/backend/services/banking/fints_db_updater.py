import asyncio
import contextlib
import io
import os
import pickle  # nosec: B403
from pathlib import Path

import fints_url
from fints_url import update_bank_info

from source.backend.logging_utils import get_logger
from source.backend.paths import BANK_DB_PATH
from source.backend.services.banking import bank_catalog

logger = get_logger(__name__)

_BANK_INFO_OVERRIDES: dict[str, dict[str, str]] = {
    # https://github.com/aqbanking/aqbanking/pull/16
    "12030000": {"blz": "12030000", "name": "Deutsche Kreditbank Berlin", "fints": "https://fints.dkb.de/fints"},
    "51390000": {
        "blz": "51390000",
        "name": "Volksbank Mittelhessen",
        "fints": "https://fints2.atruvia.de/cgi-bin/hbciservlet",
    },
}

_MIN_PLAUSIBLE_ENTRIES = 1000


def _redirect_update_target(pickle_path: Path) -> None:
    update_bank_info.__file__ = str(pickle_path)


def _reload_in_memory_db(pickle_path: Path) -> int:
    with pickle_path.open("rb") as handle:
        reloaded = pickle.load(handle)  # nosec: B301
    fints_url.__bank_info__ = reloaded
    bank_catalog.invalidate_catalog_cache()
    return len(reloaded)


def get_bank_db() -> dict[str, dict]:
    _add_bank_info_overrides_to_db()
    return fints_url.__bank_info__


def _add_bank_info_overrides_to_db() -> None:
    db = fints_url.__bank_info__
    for blz, entry in _BANK_INFO_OVERRIDES.items():
        if blz in db:
            if db[blz] != entry:
                logger.warning(f"FinTS bank DB already contains an entry for BLZ {blz} --> skipping the override")
            continue
        db[blz] = dict(entry)


def _update_raw_db_file() -> None:
    pickle_path = BANK_DB_PATH

    pickle_path.parent.mkdir(parents=True, exist_ok=True)
    if not os.access(path=pickle_path.parent, mode=os.W_OK):
        logger.warning(f"FinTS bank DB directory {pickle_path.parent} is not writable; keeping bundled DB")
        if pickle_path.exists():
            _reload_in_memory_db(pickle_path)
        return

    logger.info("Updating FinTS bank DB from the aqbanking dataset ...")
    _redirect_update_target(pickle_path)
    with contextlib.redirect_stdout(io.StringIO()):
        update_bank_info.update()

    entry_count = _reload_in_memory_db(pickle_path)
    if entry_count < _MIN_PLAUSIBLE_ENTRIES:
        logger.warning(f"FinTS bank DB looks suspiciously small ({entry_count} entries) after update")
        return

    logger.info(f"FinTS bank DB updated: {entry_count} banks")


async def run_startup_update() -> None:
    try:
        await asyncio.to_thread(_update_raw_db_file)
    except Exception as e:
        logger.exception(message="Startup FinTS bank DB update failed; keeping existing DB", exc_info=e)
    bank_catalog.invalidate_catalog_cache()
