SUPPORTED_LANGUAGES: tuple[str, ...] = ("en", "de")
DEFAULT_LANGUAGE = "en"


def list_supported_languages() -> list[str]:
    return list(SUPPORTED_LANGUAGES)


def is_supported(language: str) -> bool:
    return language in SUPPORTED_LANGUAGES
