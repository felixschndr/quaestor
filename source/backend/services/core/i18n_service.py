import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

SUPPORTED_LANGUAGES: tuple[str, ...] = ("en", "de")
DEFAULT_LANGUAGE = "en"
DEFAULT_LANGUAGE_ENV_VARIABLE_NAME = "DEFAULT_LANGUAGE"

DEFAULT_TIMEZONE = "UTC"
DISPLAY_TIMEZONE_ENV_VARIABLE_NAME = "DISPLAY_TIMEZONE"


def is_supported(language: str) -> bool:
    return language in SUPPORTED_LANGUAGES


def get_default_language() -> str:
    configured = os.environ.get(DEFAULT_LANGUAGE_ENV_VARIABLE_NAME)
    if configured is None:
        return DEFAULT_LANGUAGE
    normalized = configured.strip().lower()
    if not is_supported(normalized):
        supported = ", ".join(SUPPORTED_LANGUAGES)
        logger.warning(
            f"{DEFAULT_LANGUAGE_ENV_VARIABLE_NAME}={configured!r} is not a supported language "
            f"(supported: {supported}); falling back to {DEFAULT_LANGUAGE!r}"
        )
        return DEFAULT_LANGUAGE
    return normalized


def get_display_timezone() -> str:
    configured = os.environ.get(DISPLAY_TIMEZONE_ENV_VARIABLE_NAME)
    if configured is None:
        return DEFAULT_TIMEZONE

    normalized = configured.strip()
    if not normalized:
        return DEFAULT_TIMEZONE

    try:
        ZoneInfo(normalized)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError(
            f"{DISPLAY_TIMEZONE_ENV_VARIABLE_NAME}={configured!r} is not a valid IANA time zone"
        ) from error
    return normalized


def validate_display_timezone() -> None:
    timezone = get_display_timezone()
    logger.info(f"Rendering timestamps in time zone {timezone!r}")
