import pytest

from source.backend.services.core import i18n_service
from tests.backend.conftest import assert_log_contains


def test_unsupported_default_language_is_logged(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    monkeypatch.setenv(name=i18n_service.DEFAULT_LANGUAGE_ENV_VARIABLE_NAME, value="fr")

    assert i18n_service.get_default_language() == i18n_service.DEFAULT_LANGUAGE

    assert_log_contains(caplog, message="is not a supported language")


def test_validate_display_timezone_logs_the_configured_zone(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setenv(name=i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, value="Europe/Berlin")

    i18n_service.validate_display_timezone()

    assert_log_contains(caplog, message="Rendering timestamps in time zone 'Europe/Berlin'")
