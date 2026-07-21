import asyncio
import json

import pytest

from source.backend.services.banking import enable_banking_catalog
from tests.backend.conftest import assert_log_contains

_REAL_FETCH = enable_banking_catalog._fetch
_REAL_RUN_STARTUP_UPDATE = enable_banking_catalog.run_startup_update

_ASPSPS = [{"name": "PayPal", "country": "DE"}]


class _FakeRestAPIClient:
    def __init__(self, payload: object) -> None:
        self._payload = payload

    def __call__(self, name: str, base_url: str) -> "_FakeRestAPIClient":
        return self

    def get(self, path: str) -> dict:
        if isinstance(self._payload, Exception):
            raise self._payload
        return {"aspsps": self._payload}


def _patch_client(monkeypatch: pytest.MonkeyPatch, payload: object) -> None:
    monkeypatch.setattr(target=enable_banking_catalog, name="RestAPIClient", value=_FakeRestAPIClient(payload))


def test_fetch_stores_the_list_and_logs_the_update(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    _patch_client(monkeypatch=monkeypatch, payload=_ASPSPS)

    assert _REAL_FETCH() == _ASPSPS

    assert json.loads(enable_banking_catalog.ENABLE_BANKING_ASPSPS_PATH.read_text()) == _ASPSPS
    assert_log_contains(caplog, messages=["Fetching bank ASPSP list", "Enable Banking ASPSP list updated: 1 banks"])


def test_fetch_warns_when_the_list_comes_back_empty(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    _patch_client(monkeypatch=monkeypatch, payload=[])

    assert _REAL_FETCH() == []

    assert_log_contains(caplog, message="Enable Banking ASPSP list came back empty")


def test_load_cached_warns_about_an_unreadable_cache(caplog: pytest.LogCaptureFixture):
    enable_banking_catalog.ENABLE_BANKING_ASPSPS_PATH.write_text("not json at all")

    assert enable_banking_catalog._load_cached() == []

    assert_log_contains(caplog, message="Cached Enable Banking ASPSP list is unreadable; ignoring it")


def test_get_aspsps_logs_a_failed_fetch(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    def explode() -> list[dict]:
        raise RuntimeError("Enable Banking is down")

    monkeypatch.setattr(target=enable_banking_catalog, name="_fetch", value=explode)

    assert enable_banking_catalog.get_aspsps() == []

    assert_log_contains(caplog, message="Enable Banking ASPSP fetch failed; the catalog will not contain them")


def test_startup_update_falls_back_to_the_cached_list(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    enable_banking_catalog.ENABLE_BANKING_ASPSPS_PATH.write_text(json.dumps(_ASPSPS))

    def explode() -> list[dict]:
        raise RuntimeError("Enable Banking is down")

    monkeypatch.setattr(target=enable_banking_catalog, name="_fetch", value=explode)

    asyncio.run(_REAL_RUN_STARTUP_UPDATE())

    assert enable_banking_catalog._aspsps == _ASPSPS
    assert_log_contains(caplog, message="Enable Banking ASPSP update failed; using cached list")
