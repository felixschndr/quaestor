import os
import re
from functools import lru_cache

from source.backend.helpers import get_backend_source_path

_WHITESPACE = re.compile(r"\s+")
_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")

# Bank families: many differently named banks that share one logo
_KEYWORD_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("sparkasse",), "sparkasse"),
    (("volksbank", "raiffeisen", "vr bank", "genobank"), "volksbank"),
    (("sparda",), "sparda"),
    (("psd ",), "psd"),
    (("comdirect",), "comdirect"),
    (("commerzbank",), "commerzbank"),
    (("hypovereinsbank", "unicredit bank"), "hypovereinsbank"),
)


def _normalize(text: str) -> str:
    return _WHITESPACE.sub(repl=" ", string=text.lower().replace("-", " "))


def _slug_from_name(name: str) -> str:
    return _NON_SLUG_CHARS.sub(repl="-", string=name.lower()).strip("-")


def logo_slug(name: str) -> str:
    normalized = _normalize(name)
    for keywords, slug in _KEYWORD_RULES:
        if any(_normalize(keyword) in normalized for keyword in keywords):
            return slug
    return _slug_from_name(name)


@lru_cache(maxsize=1)
def _available_logos() -> frozenset[str]:
    logo_dir = get_backend_source_path() / "static" / "banks"
    try:
        return frozenset(file[:-4] for file in os.listdir(logo_dir) if file.endswith(".png"))
    except OSError:
        return frozenset()


def logo_exists(slug: str) -> bool:
    # A slug only yields a logo when a matching PNG is shipped; otherwise the UI shows a monogram.
    return slug in _available_logos()
