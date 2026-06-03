from pathlib import Path

import pytest
from source.backend import paths


@pytest.mark.parametrize(argnames="env_value", argvalues=[None, ""])
def test_resolve_data_dir_falls_back_to_data_dir_in_repository_root(
    env_value: str | None, monkeypatch: pytest.MonkeyPatch
):
    if env_value is None:
        monkeypatch.delenv(name=paths.DATA_DIR_ENV_VARIABLE_NAME, raising=False)
    else:
        monkeypatch.setenv(name=paths.DATA_DIR_ENV_VARIABLE_NAME, value=env_value)

    assert paths._resolve_data_dir() == paths.ROOT / "data"


@pytest.mark.parametrize(argnames="env_value", argvalues=["/data", "custom/relative", "/opt/with spaces"])
def test_resolve_data_dir_uses_env_var_when_set(env_value: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=paths.DATA_DIR_ENV_VARIABLE_NAME, value=env_value)

    assert paths._resolve_data_dir() == Path(env_value)


def test_derived_paths_live_inside_the_data_dir():
    assert paths.DATABASE_PATH == paths.DATA_DIR / "Quaestor.db"
    assert paths.BANK_DB_PATH == paths.DATA_DIR / "bank_info.pickle"
    assert paths.PLAYWRIGHT_BROWSERS_PATH == paths.DATA_DIR / "playwright"
