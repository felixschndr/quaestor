import pytest
from fastapi.testclient import TestClient

from source.backend.services import i18n_service


def test_list_languages_returns_supported_languages(http_client: TestClient):
    response = http_client.get("/api/i18n/languages")

    assert response.status_code == 200
    assert response.json() == {"languages": i18n_service.list_supported_languages()}


def test_list_languages_is_public(http_client: TestClient):
    assert http_client.get("/api/i18n/languages").status_code == 200


@pytest.mark.parametrize(
    argnames="env_value, expected",
    argvalues=[
        (None, i18n_service.DEFAULT_LANGUAGE),  # unset falls back to the default
        ("de", "de"),  # supported value is honoured
        ("  DE ", "de"),  # case and surrounding whitespace are normalized
        ("fr", i18n_service.DEFAULT_LANGUAGE),  # unsupported value falls back to the default
    ],
)
def test_get_default_language_resolves_env_value(monkeypatch: pytest.MonkeyPatch, env_value: str | None, expected: str):
    if env_value is None:
        monkeypatch.delenv(i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, raising=False)
    else:
        monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value=env_value)

    assert i18n_service.get_default_language() == expected


@pytest.mark.parametrize(
    argnames="env_value, expected",
    argvalues=[
        (None, i18n_service.DEFAULT_TIMEZONE),  # unset falls back to the default
        ("Europe/Berlin", "Europe/Berlin"),  # valid zone is honoured
        ("  Europe/Berlin  ", "Europe/Berlin"),  # surrounding whitespace is stripped
        ("   ", i18n_service.DEFAULT_TIMEZONE),  # blank value falls back to the default
    ],
)
def test_get_display_timezone_resolves_env_value(monkeypatch: pytest.MonkeyPatch, env_value: str | None, expected: str):
    if env_value is None:
        monkeypatch.delenv(i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, raising=False)
    else:
        monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value=env_value)

    assert i18n_service.get_display_timezone() == expected


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
