from pathlib import Path

import pytest

from source.backend.main import ALLOW_MISSING_FRONTEND_ENV, resolve_frontend_dist


def test_returns_path_when_dist_directory_exists(tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()

    result = resolve_frontend_dist(dist)

    assert result == dist


def test_returns_none_when_dist_missing_but_opt_out_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    missing = tmp_path / "does-not-exist"
    monkeypatch.setenv(name=ALLOW_MISSING_FRONTEND_ENV, value="true")

    result = resolve_frontend_dist(missing)

    assert result is None


def test_raises_when_dist_missing_and_opt_out_not_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    missing = tmp_path / "does-not-exist"
    monkeypatch.delenv(name=ALLOW_MISSING_FRONTEND_ENV, raising=False)

    with pytest.raises(RuntimeError, match="Frontend dist not found"):
        resolve_frontend_dist(missing)
