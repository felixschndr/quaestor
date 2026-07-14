import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from source.backend.exceptions import ApiKeyNotFoundError
from source.backend.models.api_key import ApiKey
from source.backend.services import api_key_service
from tests.backend.conftest import assert_log_contains, create_user


def test_create_returns_prefixed_token_and_stores_only_its_hash(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    user = create_user(session_factory)
    with session_factory() as db_session:
        raw_token, api_key = api_key_service.create_api_key(db_session=db_session, user=user, name="My script")

        assert_log_contains(caplog, message="Created API key")
        assert raw_token.startswith(api_key_service.TOKEN_PREFIX)
        assert api_key.name == "My script"
        assert api_key.last_used_at is None
        assert raw_token.startswith(api_key.prefix)
        stored = db_session.scalars(select(ApiKey)).one()
        assert stored.token_hash != raw_token
        assert raw_token not in stored.token_hash


def test_authenticate_returns_user_and_stamps_last_used(session_factory: sessionmaker):
    user = create_user(session_factory)
    with session_factory() as db_session:
        raw_token, _ = api_key_service.create_api_key(db_session=db_session, user=user, name="My script")

    with session_factory() as db_session:
        authenticated = api_key_service.authenticate(db_session=db_session, raw_token=raw_token)
        assert authenticated is not None
        assert authenticated.id == user.id
        assert db_session.scalars(select(ApiKey)).one().last_used_at is not None


def test_authenticate_returns_none_for_unknown_token(session_factory: sessionmaker):
    with session_factory() as db_session:
        assert api_key_service.authenticate(db_session=db_session, raw_token="qk_does-not-exist") is None  # nosec B106


def test_delete_removes_the_key(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    user = create_user(session_factory)
    with session_factory() as db_session:
        _, api_key = api_key_service.create_api_key(db_session=db_session, user=user, name="My script")
        api_key_id = api_key.id

    with session_factory() as db_session:
        api_key = api_key_service.get_api_key_for_user(db_session=db_session, api_key_id=api_key_id, user=user)
        api_key_service.delete_api_key(db_session=db_session, api_key=api_key)
        assert db_session.scalars(select(ApiKey)).all() == []

    assert_log_contains(caplog, messages=["Deleted", "<ApiKey("])


def test_get_foreign_key_raises_not_found_and_keeps_it(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    owner = create_user(session_factory, user_name="owner")
    intruder = create_user(session_factory, user_name="intruder")
    with session_factory() as db_session:
        _, api_key = api_key_service.create_api_key(db_session=db_session, user=owner, name="My script")
        api_key_id = api_key.id

    with session_factory() as db_session:
        with pytest.raises(ApiKeyNotFoundError):
            api_key_service.get_api_key_for_user(db_session=db_session, api_key_id=api_key_id, user=intruder)
        assert db_session.scalars(select(ApiKey)).one().id == api_key_id
        assert_log_contains(caplog, message="attempted to access API key")


def test_list_only_returns_the_users_own_keys(session_factory: sessionmaker):
    owner = create_user(session_factory, user_name="owner")
    intruder = create_user(session_factory, user_name="intruder")
    with session_factory() as db_session:
        api_key_service.create_api_key(db_session=db_session, user=owner, name="owner key")
        api_key_service.create_api_key(db_session=db_session, user=intruder, name="intruder key")

    with session_factory() as db_session:
        owner_keys = api_key_service.list_api_keys(db_session=db_session, user=owner)
        assert [key.name for key in owner_keys] == ["owner key"]
