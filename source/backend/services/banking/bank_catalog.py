import re
from dataclasses import asdict, dataclass
from functools import lru_cache

import fints_url
from schwifty import registry

from source.backend.bank_handlers import BANKS_BY_NAME, SUPPORTED_BANKS
from source.backend.bank_handlers.bank_logos import logo_exists, logo_slug
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_GENERIC_FINTS_PROVIDER = "fints"
_ENABLE_BANKING_PROVIDER = "enable_banking"
_NON_FINTS_PROVIDERS = frozenset({"dfs", "fin4u", "trade_republic", "manual"})

_TESTED_FINTS_PROVIDERS = frozenset(
    {"ING-DiBa", "Deutsche Kreditbank Berlin", "Sparkasse Karlsruhe", "Volksbank Mittelhessen"}
)


@dataclass(frozen=True)
class CatalogEntry:
    # One selectable bank in the picker
    provider: str
    key: str
    name: str
    bic: str | None
    icon: str | None
    tested: bool
    required_fields: list[str]
    field_rules: dict[str, dict]
    blzs: list[str]
    country: str | None = None  # Enable Banking entries only


def is_tested(provider: str, name: str) -> bool:
    if provider in _NON_FINTS_PROVIDERS or provider == _ENABLE_BANKING_PROVIDER:
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
        tested=is_tested(provider=provider, name=name),
        required_fields=bank_info.required_fields,
        field_rules=bank_info.field_rules,
        blzs=[blz] if blz is not None else [],
    )


def _normalize_bank_name(name: str) -> str:
    return re.sub(pattern=r"[^a-z0-9]", repl="", string=name.lower())


def _create_enable_banking_entry(aspsp: dict) -> CatalogEntry:
    bank_info = BANKS_BY_NAME[_ENABLE_BANKING_PROVIDER]
    # Only the application credentials are typed in (key first — uploading it autofills
    # the application ID from the file name). The ASPSP identity is pinned by the catalog
    # entry and the redirect URL is derived from the browser origin; the frontend submits
    # both alongside the visible fields (like the BLZ for FinTS).
    visible_fields = ["private_key", "application_id"]
    return CatalogEntry(
        provider=_ENABLE_BANKING_PROVIDER,
        key=f"eb-{aspsp['country']}-{aspsp['name']}",
        name=aspsp["name"],
        bic=None,
        icon=None,
        tested=True,
        required_fields=visible_fields,
        field_rules={field: rules for field, rules in bank_info.field_rules.items() if field in visible_fields},
        blzs=[],
        country=aspsp["country"],
    )


def _bank_name_tokens(name: str) -> list[str]:
    return [token for token in re.split(pattern=r"[^a-z0-9]+", string=name.lower()) if token]


@dataclass(frozen=True)
class _FintsNameIndex:
    normalized: frozenset[str]
    initials: frozenset[str]
    token_sets: tuple[frozenset[str], ...]
    multi_token: frozenset[str]

    @classmethod
    def build(cls: type["_FintsNameIndex"], names: set[str]) -> "_FintsNameIndex":
        tokens_per_name = {name: _bank_name_tokens(name) for name in names}
        return cls(
            normalized=frozenset(_normalize_bank_name(name) for name in names),
            initials=frozenset(
                "".join(token[0] for token in tokens) for tokens in tokens_per_name.values() if len(tokens) >= 2
            ),
            token_sets=tuple(frozenset(tokens) for tokens in tokens_per_name.values()),
            multi_token=frozenset(
                _normalize_bank_name(name) for name, tokens in tokens_per_name.items() if len(tokens) >= 2
            ),
        )

    def matches(self, name: str) -> bool:
        normalized = _normalize_bank_name(name)
        if len(normalized) < 3:
            return False
        if normalized in self.normalized or normalized in self.initials:
            return True
        if any(known.startswith(normalized) for known in self.normalized if len(known) >= 3):
            return True
        if any(normalized.startswith(known) for known in self.multi_token if len(known) >= 3):
            return True
        tokens = frozenset(_bank_name_tokens(name))
        return any(tokens <= known_tokens for known_tokens in self.token_sets)


def _enable_banking_entries(aspsps: list[dict], fints_names: set[str]) -> list[CatalogEntry]:
    index = _FintsNameIndex.build(fints_names)
    # Pan-EU institutions (PayPal, Revolut, ...) are listed once per country with the same integration behind them
    # Names FinTS already covers are dropped entirely (FinTS is the preferred route)
    seen_names: set[str] = set()
    entries = []
    for aspsp in aspsps:
        name = aspsp["name"]
        if name in seen_names:
            continue
        seen_names.add(name)
        if index.matches(name):
            continue
        entries.append(_create_enable_banking_entry(aspsp))
    return entries


def build_catalog(
    fints_db: dict[str, dict], schwifty_index: dict[str, dict], aspsps: list[dict] | None = None
) -> list[CatalogEntry]:
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
    entries.extend(_enable_banking_entries(aspsps=aspsps or [], fints_names=set(grouped)))
    return entries


@lru_cache(maxsize=1)
def _canonical_catalog() -> tuple[CatalogEntry, ...]:
    from source.backend.services.banking import enable_banking_catalog

    return tuple(
        build_catalog(
            fints_db=_get_fints_db(),
            schwifty_index=_schwifty_index(),
            aspsps=enable_banking_catalog.get_aspsps(),
        )
    )


@lru_cache(maxsize=1)
def _blz_to_catalog_entry_mapping() -> dict[str, CatalogEntry]:
    index = {}
    for entry in _canonical_catalog():
        for blz in entry.blzs:
            index.setdefault(blz, entry)  # noqa FKA100
    return index


def get_catalog() -> list[dict]:
    return [asdict(entry) for entry in _canonical_catalog()]


def get_name_and_icon_of_provider(
    provider: str, blz: str | None, aspsp_name: str | None = None
) -> tuple[str | None, str | None]:
    if provider == _GENERIC_FINTS_PROVIDER:
        entry = _blz_to_catalog_entry_mapping().get(blz) if blz is not None else None
        if entry is not None:
            return entry.name, entry.icon
        # Unknown BLZ (e.g. a bank missing from the FinTS DB): show the BLZ rather than nothing.
        return blz, None
    if provider == _ENABLE_BANKING_PROVIDER and aspsp_name is not None:
        return aspsp_name, None
    bank_info = BANKS_BY_NAME[provider] if provider in BANKS_BY_NAME else None
    return None, bank_info.icon if bank_info is not None else None


def invalidate_catalog_cache() -> None:
    _canonical_catalog.cache_clear()
    _blz_to_catalog_entry_mapping.cache_clear()
