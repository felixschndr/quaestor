import os

from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

SUPPORTED_LANGUAGES: tuple[str, ...] = ("en", "de")
DEFAULT_LANGUAGE = "en"
DEFAULT_LANGUAGE_ENV_VARIABLE_NAME = "DEFAULT_LANGUAGE"


def list_supported_languages() -> list[str]:
    return list(SUPPORTED_LANGUAGES)


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
