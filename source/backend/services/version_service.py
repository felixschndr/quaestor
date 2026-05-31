import functools
import tomllib
from datetime import datetime, timedelta
from typing import Any

import requests
from source.backend.helpers import get_root_path_of_repository
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

GITHUB_BASE_URL = "https://github.com/"
_CACHE_TTL = timedelta(hours=1)

# (cached_at, (version, release_url)) for the last successful fetch.
_latest_release_cache: tuple[datetime, tuple[str, str]] | None = None


@functools.cache
def _read_pyproject() -> dict[str, Any]:
    pyproject_path = get_root_path_of_repository() / "pyproject.toml"
    with pyproject_path.open("rb") as handle:
        return tomllib.load(handle)


def get_current_version() -> str:
    return _read_pyproject()["tool"]["poetry"]["version"]


def get_repository_url() -> str:
    return _read_pyproject()["tool"]["poetry"]["repository"]


def get_github_latest_release_url() -> str:
    repository_path = get_repository_url().rstrip("/").removeprefix(GITHUB_BASE_URL)
    return f"https://api.github.com/repos/{repository_path}/releases/latest"


def _parse_version(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def is_newer(current: str, latest: str) -> bool:
    try:
        return _parse_version(latest) > _parse_version(current)
    except ValueError:
        return False


def _fetch_latest_release() -> tuple[str, str] | None:
    url = get_github_latest_release_url()
    logger.info(f"Fetching latest release from GitHub: {url}")
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        logger.warning(f"Could not fetch latest release from GitHub: {error}")
        return None

    tag = str(payload.get("tag_name") or "").lstrip("v")
    release_url = payload.get("html_url")
    if not tag:
        logger.warning("GitHub latest-release response had no tag_name")
        return None
    logger.info(f"Latest release on GitHub is {tag} ({release_url})")
    return tag, release_url


def get_latest_release() -> tuple[str, str] | None:
    global _latest_release_cache
    now = datetime.now()
    if _latest_release_cache is not None and now - _latest_release_cache[0] < _CACHE_TTL:
        return _latest_release_cache[1]

    result = _fetch_latest_release()
    if result is not None:
        _latest_release_cache = (now, result)
    return result
