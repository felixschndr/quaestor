from dataclasses import asdict, dataclass
from functools import lru_cache

import fints_url
from schwifty import registry
from source.backend.bank_handlers import BANKS_BY_NAME, SUPPORTED_BANKS
from source.backend.bank_handlers.bank_logos import (
    family_for_name,
    logo_exists,
    logo_slug,
)
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_GENERIC_FINTS_PROVIDER = "fints"
_NON_FINTS_PROVIDERS = frozenset({"dfs", "fin4u", "trade_republic", "manual"})

_TESTED_FINTS_PROVIDERS = frozenset(
    {"ING-DiBa", "Deutsche Kreditbank Berlin", "Sparkasse", "Raiffeisenbank", "Volksbank"}
)


@dataclass(frozen=True)
class CatalogFamily:
    slug: str
    label: str


@dataclass(frozen=True)
class CatalogEntry:
    # One selectable bank in the picker
    provider: str
    key: str
    name: str
    bic: str | None
    icon: str | None
    family: CatalogFamily | None
    tested: bool
    required_fields: list[str]
    field_rules: dict[str, dict]
    blzs: list[str]


def is_tested(provider: str, name: str) -> bool:
    if provider in _NON_FINTS_PROVIDERS:
        return True
    return any(marker.lower() in name.lower() for marker in _TESTED_FINTS_PROVIDERS)


def _schwifty_index() -> dict[str, dict]:
    index = {}
    for bank in registry.get("bank"):
        if bank.get("country_code") != "DE":
            continue
        bank_code = bank["bank_code"]
        if bank_code not in index or bank.get("primary"):
            index[bank_code] = bank
    return index


def _get_fints_db() -> dict[str, dict]:
    return fints_url.__bank_info__


def _icon_for_name(name: str) -> str | None:
    # The bank's logo, but only when a matching PNG is actually shipped; otherwise None, so the
    # frontend renders a monogram instead
    slug = logo_slug(name)
    return f"/static/banks/{slug}.png" if logo_exists(slug) else None


def _family_of(name: str) -> CatalogFamily | None:
    family = family_for_name(name)
    return CatalogFamily(slug=family.slug, label=family.label) if family is not None else None


def _create_group_entry(name: str, blzs: list[str], schwifty_index: dict[str, dict]) -> CatalogEntry:
    ordered = sorted(blzs)
    representative = ordered[0]
    enriched = schwifty_index[representative] if representative in schwifty_index else {}
    return CatalogEntry(
        provider=_GENERIC_FINTS_PROVIDER,
        key=representative,
        name=name,
        bic=enriched.get("bic"),
        icon=_icon_for_name(name),
        family=_family_of(name),
        tested=is_tested(provider=_GENERIC_FINTS_PROVIDER, name=name),
        required_fields=["username", "password"],
        field_rules={},
        blzs=ordered,
    )


def _create_non_fints_provider_entry(provider: str) -> CatalogEntry:
    bank_info = BANKS_BY_NAME[provider]
    blz = bank_info.bank_identifier
    name = bank_info.name
    return CatalogEntry(
        provider=provider,
        key=provider,
        name=name,
        bic=None,
        icon=bank_info.icon,
        family=None,
        tested=is_tested(provider=provider, name=name),
        required_fields=bank_info.required_fields,
        field_rules=bank_info.field_rules,
        blzs=[blz] if blz is not None else [],
    )


def build_catalog(fints_db: dict[str, dict], schwifty_index: dict[str, dict]) -> list[CatalogEntry]:
    curated_blz = {
        bank.bank_identifier
        for bank in SUPPORTED_BANKS
        if bank.bank_identifier is not None and bank.name in _NON_FINTS_PROVIDERS
    }
    grouped = {}
    for blz, info in fints_db.items():
        if blz in curated_blz:
            continue
        enriched = schwifty_index[blz] if blz in schwifty_index else {}
        name = enriched.get("name") or info["name"]
        if "-alt-" in name.lower():
            continue
        grouped.setdefault(name, []).append(blz)  # noqa FKA100

    entries = [
        _create_group_entry(name=name, blzs=blzs, schwifty_index=schwifty_index) for name, blzs in grouped.items()
    ]
    entries.extend(_create_non_fints_provider_entry(provider=provider) for provider in _NON_FINTS_PROVIDERS)
    return entries


@lru_cache(maxsize=1)
def _canonical_catalog() -> tuple[CatalogEntry, ...]:
    return tuple(build_catalog(fints_db=_get_fints_db(), schwifty_index=_schwifty_index()))


@lru_cache(maxsize=1)
def _blz_to_catalog_entry_mapping() -> dict[str, CatalogEntry]:
    index = {}
    for entry in _canonical_catalog():
        for blz in entry.blzs:
            index.setdefault(blz, entry)  # noqa FKA100
    return index


def get_catalog() -> list[dict]:
    return [asdict(entry) for entry in _canonical_catalog()]


def get_name_and_icon_of_provider(provider: str, blz: str | None) -> tuple[str | None, str | None]:
    if provider == _GENERIC_FINTS_PROVIDER:
        entry = _blz_to_catalog_entry_mapping().get(blz) if blz is not None else None
        if entry is not None:
            return entry.name, entry.icon
        # Unknown BLZ (e.g. a bank missing from the FinTS DB): show the BLZ rather than nothing.
        return blz, None
    bank_info = BANKS_BY_NAME[provider] if provider in BANKS_BY_NAME else None
    return None, bank_info.icon if bank_info is not None else None


def invalidate_catalog_cache() -> None:
    _canonical_catalog.cache_clear()
    _blz_to_catalog_entry_mapping.cache_clear()
