import importlib
import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from source.backend import helpers, main
from source.backend.main import ALLOW_MISSING_FRONTEND_ENV, resolve_frontend_dist
from tests.backend.conftest import assert_log_contains


def test_returns_path_when_dist_directory_exists(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()

    result = resolve_frontend_dist(dist)

    assert result == dist


def test_returns_none_when_dist_missing_but_opt_out_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    missing = tmp_path / "does-not-exist"
    monkeypatch.setenv(name=ALLOW_MISSING_FRONTEND_ENV, value="true")

    result = resolve_frontend_dist(missing)

    assert result is None
    assert_log_contains(caplog, message="Frontend dist not found at")


def test_raises_when_dist_missing_and_opt_out_not_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    missing = tmp_path / "does-not-exist"
    monkeypatch.delenv(name=ALLOW_MISSING_FRONTEND_ENV, raising=False)

    with pytest.raises(RuntimeError, match="Frontend dist not found"):
        resolve_frontend_dist(missing)


def test_mounting_the_spa_is_logged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    dist = tmp_path / "dist"
    dist.mkdir()
    monkeypatch.setattr(target=helpers, name="get_frontend_path", value=lambda: tmp_path)
    monkeypatch.setattr(target=logging, name="basicConfig", value=MagicMock())
    state_before_reload = dict(main.__dict__)

    try:
        importlib.reload(main)
        assert_log_contains(caplog, message=f"Serving SPA from {dist}")
    finally:
        main.__dict__.clear()
        main.__dict__.update(state_before_reload)
