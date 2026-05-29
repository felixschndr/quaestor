from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BankProvider
from source.backend.bank_handlers.base import BankHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler
from source.backend.exceptions import (
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.backend.models.credential import Credential
from source.backend.services import credential_service
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    HTTP_SESSION_TOKEN,
    PHONE_NUMBER,
    PIN,
    USER_NAME,
    make_credential,
    make_user,
)


def _create_user(session_factory: sessionmaker, user_name: str = USER_NAME) -> int:
    with session_factory() as session:
        user = make_user(session, user_name=user_name)
        session.commit()
        return user.id


def _create_ing_credential(session_factory: sessionmaker, user_id: int, requires_2fa: bool = False) -> int:
    with session_factory() as session:
        credential = make_credential(session, user_id=user_id, requires_two_factor_authentication=requires_2fa)
        session.commit()
        return credential.id


def test_validated_credentials_rejects_unexpected_fields():
    with pytest.raises(MissingCredentialFieldError, match="Unexpected field"):
        credential_service._validate_credentials(
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD, "bonus_field": "x"},
        )


def test_validated_credentials_rejects_missing_required_field():
    with pytest.raises(MissingCredentialFieldError, match="Missing required field"):
        credential_service._validate_credentials(bank=BankProvider.ING, credentials={"username": BANK_USERNAME})


def test_sync_all_due_credentials_counts_synced_skipped_failed(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    user_id = _create_user(session_factory)
    syncable = _create_ing_credential(session_factory, user_id=user_id)
    two_factor = _create_ing_credential(session_factory, user_id=user_id, requires_2fa=True)
    failing = _create_ing_credential(session_factory, user_id=user_id)

    def fake_sync(credential: Credential):
        if credential.id == failing:
            raise RuntimeError("bank is not reachable")
        return credential_service.SyncResult(status=credential_service.SyncStatus.COMPLETED)

    monkeypatch.setattr(
        target=credential_service, name="sync_credential_object", value=MagicMock(side_effect=fake_sync)
    )

    with caplog.at_level("INFO", logger="source.backend.services.credential_service"):
        with session_factory() as session:
            credential_service.sync_all_due_credentials(db_session=session)

    summary = [r.message for r in caplog.records if "Periodic sync finished" in r.message]
    assert summary, [r.message for r in caplog.records]
    assert "1 synced, 1 skipped due to 2FA, 1 failed out of 3 credential(s)" in summary[-1]
    assert credential_service.sync_credential_object.call_count == 2
    synced_ids = [call.kwargs["credential"].id for call in credential_service.sync_credential_object.call_args_list]
    assert two_factor not in synced_ids
    assert {syncable, failing} == set(synced_ids)


def test_sync_credential_loads_by_id_and_returns_completed_for_handler_without_2fa(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = _create_user(session_factory)
    credential_id = _create_ing_credential(session_factory, user_id=user_id)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        result = credential_service.sync_credential(db_session=session, credential_id=credential_id)

    assert result.status == credential_service.SyncStatus.COMPLETED
    assert result.challenge_token is None


def test_sync_credential_object_for_handler_without_2fa_calls_credential_sync(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = _create_user(session_factory)
    credential_id = _create_ing_credential(session_factory, user_id=user_id)
    calls: list[object] = []

    def fake_sync(self: Credential, handler: BankHandler) -> None:
        calls.append((self, handler))

    monkeypatch.setattr(target=Credential, name="sync", value=fake_sync)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        result = credential_service.sync_credential_object(credential=credential)

    assert result.status == credential_service.SyncStatus.COMPLETED
    assert len(calls) == 1
    assert not isinstance(calls[0][1], TradeRepublicHandler)


def test_sync_credential_object_for_handler_with_2fa_returns_completed_on_resumed_session(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(
            session,
            user_id=user.id,
            bank=BankProvider.TRADE_REPUBLIC,
            credentials={"phone": PHONE_NUMBER, "pin": PIN},
        )
        credential.session_state = {"cookies": "stored-cookie"}
        session.commit()
        credential_id = credential.id

    def fake_sync(self: Credential, handler: BankHandler) -> None:
        assert handler.session_state == {"cookies": "stored-cookie"}
        handler.session_state = {"cookies": "refreshed-cookie"}

    monkeypatch.setattr(target=Credential, name="sync", value=fake_sync)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        result = credential_service.sync_credential_object(credential=credential)
        assert credential.session_state == {"cookies": "refreshed-cookie"}

    assert result.status == credential_service.SyncStatus.COMPLETED


def test_sync_credential_object_for_handler_with_2fa_starts_2fa_when_reauth_required(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(
            session,
            user_id=user.id,
            bank=BankProvider.TRADE_REPUBLIC,
            credentials={"phone": PHONE_NUMBER, "pin": PIN},
        )
        session.commit()
        credential_id = credential.id

    def raise_reauth(self: Credential, handler: BankHandler) -> None:
        assert isinstance(handler, TradeRepublicHandler)
        raise ReauthenticationRequiredError("expired")

    monkeypatch.setattr(target=Credential, name="sync", value=raise_reauth)
    expires_at = datetime.now() + timedelta(minutes=5)
    start_login = MagicMock(return_value=(HTTP_SESSION_TOKEN, expires_at))
    monkeypatch.setattr(target=credential_service.trade_republic_login, name="start", value=start_login)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        result = credential_service.sync_credential_object(credential=credential)
        assert credential.requires_two_factor_authentication is True

    assert result.status == credential_service.SyncStatus.TWO_FACTOR_REQUIRED
    assert result.challenge_token == HTTP_SESSION_TOKEN
    assert result.expires_at == expires_at
    start_login.assert_called_once_with(credential_id=credential_id, phone_no=PHONE_NUMBER, pin=PIN)


def test_confirm_two_factor_completes_login_and_syncs_credential(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(
            session,
            user_id=user.id,
            bank=BankProvider.TRADE_REPUBLIC,
            credentials={"phone": PHONE_NUMBER, "pin": PIN},
        )
        session.commit()
        credential_id = credential.id

    complete_login = MagicMock(return_value="cookies-from-2fa")
    monkeypatch.setattr(target=credential_service.trade_republic_login, name="complete", value=complete_login)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        result = credential_service.confirm_two_factor(
            db_session=session, credential_id=credential_id, challenge_token="abc", code="0000"  # nosec B106
        )

    assert result.status == credential_service.SyncStatus.COMPLETED
    complete_login.assert_called_once_with(
        challenge_token="abc", credential_id=credential_id, code="0000"
    )  # nosec B106
    with session_factory() as session:
        assert session.get(entity=Credential, ident=credential_id).session_state == {"cookies": "cookies-from-2fa"}


def test_sync_all_due_credentials_logs_exception_per_failure(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    user_id = _create_user(session_factory)
    failing = _create_ing_credential(session_factory, user_id=user_id)

    def fake_sync(credential: Credential):
        raise RuntimeError(f"something went wrong when syncing {credential}")

    monkeypatch.setattr(
        target=credential_service, name="sync_credential_object", value=MagicMock(side_effect=fake_sync)
    )

    with caplog.at_level("ERROR", logger="source.backend.services.credential_service"):
        with session_factory() as session:
            credential_service.sync_all_due_credentials(db_session=session)

    error_messages = [r.message for r in caplog.records if r.levelname == "ERROR"]
    assert any("Periodic sync failed" in msg for msg in error_messages), error_messages
    assert f"id={failing}" in " ".join(error_messages)
