import pytest
from source.backend.services import bank_catalog
from source.backend.services.bank_catalog import CatalogEntry, CatalogFamily


def _fake_fints_db() -> dict[str, dict]:
    return {
        "50010517": {"blz": "50010517", "name": "ING-DiBa", "fints": "https://stale.example/"},
        "12030000": {"blz": "12030000", "name": "Deutsche Kreditbank", "fints": "https://stale.dkb/"},
        "70150000": {"blz": "70150000", "name": "Stadtsparkasse München", "fints": "https://s/"},
        "10070000": {"blz": "10070000", "name": "Deutsche Bank Fill A", "fints": "https://db/"},
        "12070000": {"blz": "12070000", "name": "Deutsche Bank Fill B", "fints": "https://db/"},
        "13061008": {"blz": "13061008", "name": "Volksbank Wolgast -alt-", "fints": "https://vb/"},
    }


def _fake_schwifty() -> dict[str, dict]:
    return {
        "70150000": {"name": "Sparkasse München", "bic": "SSKMDEMMXXX"},
        "10070000": {"name": "Deutsche Bank", "bic": "DEUTDEFFXXX"},
        "12070000": {"name": "Deutsche Bank", "bic": "DEUTDEDBXXX"},
    }


def _build() -> list[CatalogEntry]:
    return bank_catalog.build_catalog(fints_db=_fake_fints_db(), schwifty_index=_fake_schwifty())


def _by_key(catalog: list[CatalogEntry], key: str) -> CatalogEntry:
    return next(e for e in catalog if e.key == key)


def test_generic_fints_entry_has_login_and_password_only() -> None:
    entry = _by_key(_build(), key="70150000")

    assert entry.provider == "fints"
    assert entry.required_fields == ["username", "password"]
    assert entry.field_rules == {}


def test_schwifty_enriches_name_and_bic() -> None:
    entry = _by_key(_build(), key="10070000")

    assert entry.name == "Deutsche Bank"
    assert entry.bic == "DEUTDEFFXXX"


def test_same_named_banks_are_grouped_into_one_entry() -> None:
    catalog = _build()

    db_entries = [e for e in catalog if e.provider == "fints" and e.name == "Deutsche Bank"]
    assert len(db_entries) == 1
    assert db_entries[0].blzs == ["10070000", "12070000"]
    assert db_entries[0].key == "10070000"


@pytest.mark.parametrize(argnames="blz, expected_tested", argvalues=[("70150000", True), ("10070000", False)])
def test_entry_is_tested_via_keyword(blz: str, expected_tested: bool) -> None:
    assert _by_key(_build(), key=blz).tested is expected_tested


def test_deprecated_alt_entries_are_excluded() -> None:
    catalog = _build()

    assert not any("-alt-" in e.name for e in catalog)
    assert not any("13061008" in e.blzs for e in catalog)


def test_custom_providers_are_injected() -> None:
    catalog = _build()

    providers = {e.provider for e in catalog}
    assert {"dfs", "fin4u", "trade_republic", "manual"} <= providers
    tr = _by_key(catalog, key="trade_republic")
    assert tr.tested is True
    assert tr.blzs == []


def test_icon_uses_logo_slug_for_fints_entries() -> None:
    assert _by_key(_build(), key="70150000").icon == "/static/banks/sparkasse.png"


def test_fints_entries_carry_their_family() -> None:
    catalog = _build()

    assert _by_key(catalog, key="70150000").family == CatalogFamily(slug="sparkasse", label="Sparkasse")
    assert _by_key(catalog, key="10070000").family is None


def test_non_fints_providers_have_no_family() -> None:
    assert _by_key(_build(), key="trade_republic").family is None


def test_get_catalog_serializes_entries_to_plain_dicts() -> None:
    entry = next(e for e in bank_catalog.get_catalog() if e["provider"] == "manual")
    assert isinstance(entry, dict)
    assert entry["family"] is None


@pytest.mark.parametrize(
    argnames="provider, name, expected",
    argvalues=[
        ("trade_republic", "trade_republic", True),
        ("dfs", "dfs", True),
        ("fints", "ING-DiBa", True),
        ("fints", "Deutsche Kreditbank Berlin", True),
        ("fints", "Stadtsparkasse München", True),
        ("fints", "Volksbank Mittelhessen", True),
        ("fints", "Commerzbank", False),
        ("manual", "manual", True),
    ],
)
def test_is_tested(provider: str, name: str, expected: bool) -> None:
    assert bank_catalog.is_tested(provider=provider, name=name) is expected


def test_credential_display_resolves_a_fints_blz_to_name_and_icon() -> None:
    name, icon = bank_catalog.get_name_and_icon_of_provider(provider="fints", blz="50010517")

    assert name == "ING-DiBa"
    assert icon == "/static/banks/ing-diba.png"


def test_credential_display_for_curated_provider_has_icon_but_no_name() -> None:
    # The localised name of a curated provider comes from the frontend, so name is None.
    name, icon = bank_catalog.get_name_and_icon_of_provider(provider="manual", blz=None)

    assert name is None
    assert icon is not None


def test_credential_display_falls_back_to_the_blz_for_an_unknown_bank() -> None:
    assert bank_catalog.get_name_and_icon_of_provider(provider="fints", blz="99999999") == ("99999999", None)
