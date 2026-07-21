import asyncio
import logging
from pathlib import Path

import fints_url
import pytest

from source.backend.services.banking import fints_db_updater as updater
from tests.backend.conftest import assert_log_contains

_REAL_RUN_STARTUP_UPDATE = updater.run_startup_update


@pytest.fixture
def isolated_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    pickle_path = tmp_path / "bank_info.pickle"
    monkeypatch.setattr(target=updater, name="BANK_DB_PATH", value=pickle_path)
    return pickle_path


def test_update_always_runs(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    calls = []
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: calls.append("update"))
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda _path: 1244)

    updater._update_raw_db_file()

    assert calls == ["update"]
    assert_log_contains(
        caplog, messages=["Updating FinTS bank DB from the aqbanking dataset", "FinTS bank DB updated:"]
    )


def test_update_redirects_fints_url_writer_to_our_path(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: None)
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda _path: 1244)

    updater._update_raw_db_file()

    assert updater.update_bank_info.__file__ == str(isolated_paths)


def test_warning_is_logged_when_update_looks_too_small(
    isolated_paths: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: None)
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda _path: 3)

    updater._update_raw_db_file()

    assert_log_contains(caplog, message="looks suspiciously small")


def test_apply_overrides_injects_banks_missing_from_the_dataset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=fints_url, name="__bank_info__", value={})

    updater.get_bank_db()

    assert fints_url.__bank_info__["12030000"]["fints"] == "https://fints.dkb.de/fints"
    assert fints_url.find(bank_code="12030000") == "https://fints.dkb.de/fints"


def test_apply_overrides_keeps_a_dataset_entry_if_present(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(
        target=fints_url,
        name="__bank_info__",
        value={"12030000": {"blz": "12030000", "name": "DKB", "fints": "https://from-dataset/"}},
    )

    with caplog.at_level(logging.WARNING):
        updater.get_bank_db()

    assert fints_url.__bank_info__["12030000"]["fints"] == "https://from-dataset/"
    assert_log_contains(caplog, message="FinTS bank DB already contains an entry for BLZ 12030000")


def test_update_keeps_bundled_db_when_the_directory_is_not_writable(
    isolated_paths: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    reloaded: list[Path] = []
    isolated_paths.write_bytes(b"bundled")
    monkeypatch.setattr(target=updater.os, name="access", value=lambda path, mode: False)
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda path: reloaded.append(path))

    updater._update_raw_db_file()

    assert reloaded == [isolated_paths]
    assert_log_contains(caplog, message="is not writable; keeping bundled DB")


def test_startup_update_logs_the_failure_and_does_not_raise(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    def explode() -> None:
        raise RuntimeError("dataset unreachable")

    monkeypatch.setattr(target=updater, name="_update_raw_db_file", value=explode)

    asyncio.run(_REAL_RUN_STARTUP_UPDATE())

    assert_log_contains(caplog, message="Startup FinTS bank DB update failed; keeping existing DB")
