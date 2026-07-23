import os
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

SUPPORTED_LANGUAGES: tuple[str, ...] = ("en", "de")
DEFAULT_LANGUAGE = "en"
DEFAULT_LANGUAGE_ENV_VARIABLE_NAME = "DEFAULT_LANGUAGE"

CURRENCY_SYMBOLS: dict[str, str] = {
    "EUR": "€",
    "USD": "$",
    "GBP": "£",
    "CHF": "CHF",
    "JPY": "¥",
    "CAD": "C$",
    "AUD": "A$",
}
SUPPORTED_CURRENCIES: tuple[str, ...] = tuple(CURRENCY_SYMBOLS)
DEFAULT_CURRENCY = "EUR"
DEFAULT_CURRENCY_ENV_VARIABLE_NAME = "DEFAULT_CURRENCY"

DEFAULT_TIMEZONE = "UTC"
DISPLAY_TIMEZONE_ENV_VARIABLE_NAME = "DISPLAY_TIMEZONE"


def is_supported(language: str) -> bool:
    return language in SUPPORTED_LANGUAGES


def is_supported_currency(currency: str) -> bool:
    return currency in SUPPORTED_CURRENCIES


def currency_symbol(currency: str) -> str:
    return CURRENCY_SYMBOLS[currency] if currency in CURRENCY_SYMBOLS else currency


def get_default_currency() -> str:
    configured = os.environ.get(DEFAULT_CURRENCY_ENV_VARIABLE_NAME)
    if configured is None:
        return DEFAULT_CURRENCY
    normalized = configured.strip().upper()
    if not is_supported_currency(normalized):
        supported = ", ".join(SUPPORTED_CURRENCIES)
        logger.warning(
            f"{DEFAULT_CURRENCY_ENV_VARIABLE_NAME}={configured!r} is not a supported currency "
            f"(supported: {supported}); falling back to {DEFAULT_CURRENCY!r}"
        )
        return DEFAULT_CURRENCY
    return normalized


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
