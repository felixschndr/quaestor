import logging
import os
import time
from datetime import timedelta
from pathlib import Path

import fints_url
import pytest
from source.backend.services import bank_info_updater as updater


@pytest.fixture
def isolated_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    pickle_path = tmp_path / "bank_info.pickle"
    monkeypatch.setattr(target=updater, name="_pickle_path", value=lambda: pickle_path)
    return pickle_path


def test_is_fresh_enough_is_false_without_a_marker(isolated_paths: Path):
    # a freshly installed pickle must NOT count as fresh to refresh
    assert updater._is_fresh_enough(timedelta(days=7)) is False


def test_is_fresh_enough_is_true_with_a_recent_marker(isolated_paths: Path):
    updater._freshness_marker_path().touch()
    assert updater._is_fresh_enough(timedelta(days=7)) is True


def test_is_fresh_enough_is_false_with_a_stale_marker(isolated_paths: Path):
    marker = updater._freshness_marker_path()
    marker.touch()
    stale = time.time() - timedelta(days=8).total_seconds()
    os.utime(path=marker, times=(stale, stale))

    assert updater._is_fresh_enough(timedelta(days=7)) is False


def test_update_runs_and_writes_marker_when_not_fresh(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch):
    calls = []
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: calls.append("update"))
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda _path: 1244)

    updater._update_raw_db_file()

    assert calls == ["update"]
    assert updater._freshness_marker_path().exists()


def test_update_is_skipped_when_marker_is_fresh(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch):
    updater._freshness_marker_path().touch()
    calls = []
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: calls.append("update"))

    updater._update_raw_db_file()

    assert calls == []


def test_persisted_db_is_loaded_into_memory_when_fresh(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch):
    isolated_paths.touch()
    updater._freshness_marker_path().touch()
    reloaded = []
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda path: reloaded.append(path))
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: pytest.fail("must not update"))

    updater._update_raw_db_file()

    assert reloaded == [isolated_paths]


def test_update_redirects_fints_url_writer_to_our_path(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: None)
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda _path: 1244)

    updater._update_raw_db_file()

    assert updater.update_bank_info.__file__ == str(isolated_paths)


def test_marker_is_not_written_when_update_looks_too_small(isolated_paths: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=updater.update_bank_info, name="update", value=lambda: None)
    monkeypatch.setattr(target=updater, name="_reload_in_memory_db", value=lambda _path: 3)

    updater._update_raw_db_file()

    assert not updater._freshness_marker_path().exists()


def test_apply_overrides_injects_banks_missing_from_the_dataset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=fints_url, name="__bank_info__", value={})

    updater.add_bank_info_overrides_to_db()

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
        updater.add_bank_info_overrides_to_db()

    assert fints_url.__bank_info__["12030000"]["fints"] == "https://from-dataset/"
    assert any("12030000" in record.message for record in caplog.records if record.levelno == logging.WARNING)
