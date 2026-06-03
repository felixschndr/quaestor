from unittest.mock import MagicMock

import pytest
from source.backend.exceptions import UserNameAlreadyExistsError
from source.backend.services import user_service
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    DISPLAY_NAME,
    SECOND_USER_NAME,
    USER_NAME,
    VALID_PASSWORD,
    create_user,
)


def test_list_users_returns_all_users(session_factory: sessionmaker):
    create_user(session_factory, user_name=USER_NAME)
    create_user(session_factory, user_name=SECOND_USER_NAME)

    with session_factory() as session:
        users = user_service.list_users(db_session=session)

    assert {user.user_name for user in users} == {USER_NAME, SECOND_USER_NAME}


def test_list_users_returns_empty_when_no_rows(session_factory: sessionmaker):
    with session_factory() as session:
        assert user_service.list_users(db_session=session) == []


def test_create_user_defaults_language_to_english_when_unset(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.delenv("DEFAULT_LANGUAGE", raising=False)

    with session_factory() as session:
        with caplog.at_level("INFO", logger="services.user_service"):
            user = user_service.create_user(
                db_session=session, user_name=USER_NAME, display_name=DISPLAY_NAME, password=VALID_PASSWORD
            )
        assert user.language == "en"

    assert any("Created user" in record.getMessage() and "<User(" in record.getMessage() for record in caplog.records)
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
