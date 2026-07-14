import asyncio
import logging
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from source.backend.services.banking import playwright_browser
from tests.backend.conftest import assert_log_contains

pytestmark = pytest.mark.real_playwright_browser

LOGGER_NAME = "services.banking.playwright_browser"


def _patch_executable_path(monkeypatch: pytest.MonkeyPatch, path: Path) -> None:
    monkeypatch.setattr(target=playwright_browser, name="_chromium_executable_path", value=AsyncMock(return_value=path))


def test_skips_download_when_browser_already_present(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    existing = tmp_path / "chrome"
    existing.write_text("binary")
    _patch_executable_path(monkeypatch=monkeypatch, path=existing)

    download = AsyncMock()
    monkeypatch.setattr(target=playwright_browser, name="_download_chromium", value=download)

    with caplog.at_level(logging.DEBUG, logger=LOGGER_NAME):
        asyncio.run(playwright_browser.ensure_chromium_installed())

    download.assert_not_called()
    assert_log_contains(caplog, message="already present")


def test_downloads_when_browser_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    missing = tmp_path / "does-not-exist" / "chrome"
    _patch_executable_path(monkeypatch=monkeypatch, path=missing)

    download = AsyncMock()
    monkeypatch.setattr(target=playwright_browser, name="_download_chromium", value=download)

    asyncio.run(playwright_browser.ensure_chromium_installed())

    download.assert_awaited_once()
    assert_log_contains(caplog, message="downloading")
    assert_log_contains(caplog, message="downloaded successfully")


def test_download_failure_is_logged_and_does_not_raise(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    missing = tmp_path / "does-not-exist" / "chrome"
    _patch_executable_path(monkeypatch=monkeypatch, path=missing)

    download = AsyncMock(side_effect=RuntimeError("network down"))
    monkeypatch.setattr(target=playwright_browser, name="_download_chromium", value=download)

    asyncio.run(playwright_browser.ensure_chromium_installed())

    assert_log_contains(caplog, message="Failed to download")
