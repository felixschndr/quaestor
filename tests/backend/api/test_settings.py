import pytest
from fastapi.testclient import TestClient
from source.backend.services import i18n_service
from source.backend.services.sync_scheduler import SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME
from source.backend.services.user_service import (
    ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME,
)


def test_settings_returns_defaults(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, raising=False)

    response = http_client.get("/api/settings")

    assert response.status_code == 200
    assert response.json() == {
        "allow_new_user_registration": True,
        "default_language": i18n_service.DEFAULT_LANGUAGE,
        "display_timezone": i18n_service.DEFAULT_TIMEZONE,
        "sync_interval_hours": 12.0,
    }


def test_settings_reflects_env_variables(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, value="false")
    monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value="de")
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Europe/Berlin")
    monkeypatch.setenv(name=SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, value="6")

    response = http_client.get("/api/settings")

    assert response.status_code == 200
    assert response.json() == {
        "allow_new_user_registration": False,
        "default_language": "de",
        "display_timezone": "Europe/Berlin",
        "sync_interval_hours": 6.0,
    }


def test_settings_is_public(http_client: TestClient):
    assert http_client.get("/api/settings").status_code == 200
