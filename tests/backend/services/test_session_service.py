from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from source.backend.exceptions import InvalidCredentialsError
from source.backend.models.session import UserSession
from source.backend.models.user import User
from source.backend.services import session_service
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import HTTP_SESSION_TOKEN, make_user


def _create_user(session_factory: sessionmaker) -> User:
    with session_factory() as db_session:
        user = make_user(db_session)
        db_session.commit()
        db_session.refresh(user)
        return user


def test_lookup_returns_none_for_unknown_token(session_factory: sessionmaker):
    with session_factory() as db_session:
        assert session_service.renew_session(db_session=db_session, raw_token=HTTP_SESSION_TOKEN) is None
        assert session_service.get_user_by_raw_token(db_session=db_session, raw_token=HTTP_SESSION_TOKEN) is None


def test_lookup_returns_none_for_expired_session(session_factory: sessionmaker):
    user = _create_user(session_factory=session_factory)
    with session_factory() as db_session:
        raw_token = session_service.create_session(db_session=db_session, user=user)
        only_session = db_session.scalars(select(UserSession)).one()
        only_session.expires_at = datetime.now() - timedelta(seconds=1)
        db_session.commit()

    with session_factory() as db_session:
        assert session_service.renew_session(db_session=db_session, raw_token=raw_token) is None
        assert session_service.get_user_by_raw_token(db_session=db_session, raw_token=raw_token) is None


def test_delete_session_is_noop_when_token_does_not_match(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with caplog.at_level("WARNING", logger="source.backend.services.session_service"):
        with session_factory() as db_session:
            session_service.delete_session(db_session=db_session, raw_token=HTTP_SESSION_TOKEN)

    assert any("no matching session" in r.message for r in caplog.records)


def test_get_current_user_from_request_raises_when_cookie_present_but_unknown(session_factory: sessionmaker):
    request = MagicMock()
    request.cookies = {session_service.COOKIE_NAME: HTTP_SESSION_TOKEN}
    request.method = "GET"
    request.url.path = "/api/auth/me"

    with session_factory() as db_session:
        with pytest.raises(InvalidCredentialsError):
            session_service.get_current_user_from_request(request=request, db_session=db_session)


def test_renew_session_extends_expiry_and_last_used_for_valid_session(session_factory: sessionmaker):
    user = _create_user(session_factory=session_factory)
    with session_factory() as db_session:
        raw_token = session_service.create_session(db_session=db_session, user=user)
        original = db_session.scalars(select(UserSession)).one()
        original_expiry = original.expires_at
        original_last_used = original.last_used_at

    with session_factory() as db_session:
        renewed = session_service.renew_session(db_session=db_session, raw_token=raw_token)

        assert renewed is not None
        assert renewed.expires_at >= original_expiry
        assert renewed.last_used_at >= original_last_used
