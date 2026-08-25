from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from source.backend.exceptions import UserNameAlreadyExistsError
from source.backend.services.auth import user_service
from tests.backend.conftest import (
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD,
    assert_log_contains,
)


def test_create_user_defaults_language_to_english_when_unset(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.delenv("DEFAULT_LANGUAGE", raising=False)

    with session_factory() as session:
        user = user_service.create_user(
            db_session=session, user_name=USER_NAME, display_name=DISPLAY_NAME, password=VALID_PASSWORD
        )
        assert user.language == "en"

    assert_log_contains(caplog, messages=["Created <User("])
    assert "password_hash" not in caplog.text


def test_create_user_uses_configured_default_language(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name="DEFAULT_LANGUAGE", value="de")

    with session_factory() as session:
        user = user_service.create_user(
            db_session=session, user_name=USER_NAME, display_name=DISPLAY_NAME, password=VALID_PASSWORD
        )
        assert user.language == "de"


def test_create_user_translates_integrity_error_to_user_name_already_exists(monkeypatch: pytest.MonkeyPatch):
    session = MagicMock()
    session.scalar.return_value = None  # pre-check sees no existing row
    session.commit.side_effect = IntegrityError(statement="INSERT", params=None, orig=Exception("UNIQUE"))

    with pytest.raises(UserNameAlreadyExistsError, match="already taken"):
        user_service.create_user(
            db_session=session, user_name=USER_NAME, display_name=DISPLAY_NAME, password=VALID_PASSWORD
        )

    session.rollback.assert_called_once()
