import requests
from source.backend.helpers import (
    get_content_of_pyproject_toml,
    get_project_version,
)
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)


def get_current_version() -> str:
    return get_project_version()


def get_repository_url() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["repository"]


def get_github_latest_release_url() -> str:
    repository_path = get_repository_url().rstrip("/").removeprefix("https://github.com/")
    return f"https://api.github.com/repos/{repository_path}/releases/latest"


def _parse_version(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def is_newer(current: str, latest: str) -> bool:
    try:
        return _parse_version(latest) > _parse_version(current)
    except ValueError:
        return False


def get_latest_release() -> tuple[str, str] | None:
    url = get_github_latest_release_url()
    logger.debug(f"Fetching latest release from GitHub: {url}")
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
