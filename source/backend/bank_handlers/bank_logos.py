import os
import re
from dataclasses import dataclass
from functools import lru_cache

from source.backend.helpers import get_backend_source_path

_WHITESPACE = re.compile(r"\s+")
_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class BankFamily:
    # A group of differently named banks that share one brand and logo (e.g., volksbank)

    slug: str
    label: str
    keywords: tuple[str, ...]


BANK_FAMILIES: tuple[BankFamily, ...] = (
    BankFamily(slug="sparkasse", label="Sparkasse", keywords=("sparkasse",)),
    BankFamily(
        slug="volksbank",
        label="Volksbank Raiffeisenbank",
        keywords=("volksbank", "raiffeisen", "vr ", "genobank", "genossenschaftsbank"),
    ),
    BankFamily(slug="sparda", label="Sparda-Bank", keywords=("sparda",)),
    BankFamily(slug="psd", label="PSD Bank", keywords=("psd ",)),
    # comdirect must precede commerzbank: "Commerzbank - GF comdirect" belongs to comdirect.
    BankFamily(slug="comdirect", label="comdirect", keywords=("comdirect",)),
    BankFamily(slug="commerzbank", label="Commerzbank", keywords=("commerzbank",)),
    BankFamily(slug="hypovereinsbank", label="HypoVereinsbank", keywords=("hypovereinsbank", "unicredit bank")),
)


def _normalize(text: str) -> str:
    return _WHITESPACE.sub(repl=" ", string=text.lower().replace("-", " "))


def _slug_from_name(name: str) -> str:
    return _NON_SLUG_CHARS.sub(repl="-", string=name.lower()).strip("-")


def family_for_name(name: str) -> BankFamily | None:
    """The family a bank name belongs to, or None when it stands alone."""
    normalized = _normalize(name)
    for family in BANK_FAMILIES:
        if any(_normalize(keyword) in normalized for keyword in family.keywords):
            return family
    return None


def logo_slug(name: str) -> str:
    family = family_for_name(name)
    return family.slug if family is not None else _slug_from_name(name)


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
