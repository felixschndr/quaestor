import pytest
from fastapi.testclient import TestClient
from source.backend.services import i18n_service


def test_list_languages_returns_supported_languages(http_client: TestClient):
    response = http_client.get("/api/i18n/languages")

    assert response.status_code == 200
    assert response.json() == {"languages": i18n_service.list_supported_languages()}


def test_list_languages_is_public(http_client: TestClient):
    assert http_client.get("/api/i18n/languages").status_code == 200


def test_get_default_language_falls_back_when_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, raising=False)

    assert i18n_service.get_default_language() == i18n_service.DEFAULT_LANGUAGE


def test_get_default_language_honours_a_supported_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value="de")

    assert i18n_service.get_default_language() == "de"


def test_get_default_language_normalizes_case_and_whitespace(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value="  DE ")

    assert i18n_service.get_default_language() == "de"


def test_get_default_language_falls_back_on_unsupported_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value="fr")

    assert i18n_service.get_default_language() == i18n_service.DEFAULT_LANGUAGE


def test_get_display_timezone_falls_back_when_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, raising=False)

    assert i18n_service.get_display_timezone() == i18n_service.DEFAULT_TIMEZONE


def test_get_display_timezone_honours_a_valid_zone(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Europe/Berlin")

    assert i18n_service.get_display_timezone() == "Europe/Berlin"


def test_get_display_timezone_strips_whitespace(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="  Europe/Berlin  ")

    assert i18n_service.get_display_timezone() == "Europe/Berlin"


def test_get_display_timezone_falls_back_on_empty_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="   ")

    assert i18n_service.get_display_timezone() == i18n_service.DEFAULT_TIMEZONE


def test_get_display_timezone_raises_on_invalid_zone(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Not/AZone")

    with pytest.raises(ValueError, match="Not/AZone"):
        i18n_service.get_display_timezone()


def test_validate_display_timezone_passes_for_a_valid_zone(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Europe/Berlin")

    i18n_service.validate_display_timezone()


def test_validate_display_timezone_raises_on_invalid_zone(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Europde")

    with pytest.raises(ValueError, match="Europde"):
        i18n_service.validate_display_timezone()
