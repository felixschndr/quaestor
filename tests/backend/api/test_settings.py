import pytest
from fastapi.testclient import TestClient

from source.backend.services.auth.user_service import ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME
from source.backend.services.banking.sync_scheduler import SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME
from source.backend.services.core import i18n_service
from source.backend.services.transactions import attachment_service


def test_settings_returns_defaults(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(i18n_service.DEFAULT_CURRENCY_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, raising=False)
    monkeypatch.delenv(attachment_service.MAX_ATTACHMENT_SIZE_MB_ENV_VARIABLE_NAME, raising=False)

    response = http_client.get("/api/settings")

    assert response.status_code == 200
    assert response.json() == {
        "allow_new_user_registration": True,
        "default_language": i18n_service.DEFAULT_LANGUAGE,
        "default_currency": i18n_service.DEFAULT_CURRENCY,
        "display_timezone": i18n_service.DEFAULT_TIMEZONE,
        "sync_interval_hours": 12.0,
        "allowed_attachment_extensions": sorted(attachment_service.ALLOWED_EXTENSIONS),
        "max_attachment_size_mb": attachment_service.DEFAULT_MAX_ATTACHMENT_SIZE_MB,
    }


def test_settings_reflects_env_variables(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, value="false")
    monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value="de")
    monkeypatch.setenv(name=i18n_service.DEFAULT_CURRENCY_ENV_VARIABLE_NAME, value="USD")
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Europe/Berlin")
    monkeypatch.setenv(name=SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, value="6")
    monkeypatch.setenv(name=attachment_service.MAX_ATTACHMENT_SIZE_MB_ENV_VARIABLE_NAME, value="5")

    response = http_client.get("/api/settings")

    assert response.status_code == 200
    assert response.json() == {
        "allow_new_user_registration": False,
        "default_language": "de",
        "default_currency": "USD",
        "display_timezone": "Europe/Berlin",
        "sync_interval_hours": 6.0,
        "allowed_attachment_extensions": sorted(attachment_service.ALLOWED_EXTENSIONS),
        "max_attachment_size_mb": 5,
    }


def test_settings_is_public(http_client: TestClient):
    assert http_client.get("/api/settings").status_code == 200
