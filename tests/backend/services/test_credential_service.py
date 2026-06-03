from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BankProvider
from source.backend.bank_handlers.base import BankHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler
from source.backend.exceptions import (
    InvalidCredentialFieldError,
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.backend.models.credential import Credential
from source.backend.services import credential_service, trade_republic_login
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    CHALLENGE_TOKEN,
    HTTP_SESSION_TOKEN,
    PHONE_NUMBER,
    PIN,
    VALID_PASSWORD,
    create_user,
    make_credential,
    make_user,
    persist_credential,
)


def test_validated_credentials_rejects_unexpected_fields():
    with pytest.raises(MissingCredentialFieldError, match="Unexpected field"):
        credential_service._validate_credentials(
            bank=BankProvider.FINTS,
            credentials={
                "username": BANK_USERNAME,
                "password": BANK_PASSWORD,
                "blz": "50010517",
                "bonus_field": "x",
            },
        )


def test_validated_credentials_rejects_missing_required_field():
    with pytest.raises(MissingCredentialFieldError, match="Missing required field"):
        credential_service._validate_credentials(bank=BankProvider.FINTS, credentials={"username": BANK_USERNAME})


def test_validate_credentials_strips_whitespace_for_trade_republic():
    cleaned = credential_service._validate_credentials(
        bank=BankProvider.TRADE_REPUBLIC,
        credentials={"phone": "+49 151 23 45", "pin": PIN},
    )
    assert cleaned == {"phone": "+491512345", "pin": PIN}


@pytest.mark.parametrize(argnames="phone_number", argvalues=["491512345", "01512345"])
def test_validate_credentials_rejects_phone_without_country_code(phone_number: str):
    with pytest.raises(InvalidCredentialFieldError):
        credential_service._validate_credentials(
            bank=BankProvider.TRADE_REPUBLIC,
            credentials={"phone": phone_number, "pin": PIN},
        )


def test_validate_credentials_rejects_pin_that_is_not_four_digits():
    with pytest.raises(InvalidCredentialFieldError):
        credential_service._validate_credentials(
            bank=BankProvider.TRADE_REPUBLIC,
            credentials={"phone": PHONE_NUMBER, "pin": "12"},
        )


def test_validate_credentials_strips_whitespace_from_fints_blz():
    cleaned = credential_service._validate_credentials(
        bank=BankProvider.FINTS,
        credentials={"username": BANK_USERNAME, "password": VALID_PASSWORD, "blz": "660 501 01"},
    )
    assert cleaned["blz"] == "66050101"
    assert cleaned["password"] == VALID_PASSWORD  # this contains spaces which should not be stripped


def test_sync_all_due_credentials_counts_synced_skipped_failed(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    user_id = create_user(session_factory).id
    syncable = persist_credential(session_factory, user_id=user_id)
    two_factor = persist_credential(session_factory, user_id=user_id, requires_two_factor_authentication=True)
    failing = persist_credential(session_factory, user_id=user_id)

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
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        result = credential_service.sync_credential(db_session=session, credential_id=credential_id)

    assert result.status == credential_service.SyncStatus.COMPLETED
    assert result.challenge_token is None


def test_sync_credential_object_for_handler_without_2fa_calls_credential_sync(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)
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


def test_sync_marks_credential_when_handler_requests_two_factor(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def fake_sync(self: Credential, handler: BankHandler) -> None:
        notifier = handler.notify_two_factor_state
        if notifier is not None:
            notifier(True)
            notifier(False)  # Ignore setting it back to false after setting it to true once

    monkeypatch.setattr(target=Credential, name="sync", value=fake_sync)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        result = credential_service.sync_credential_object(credential=credential)
        assert credential.requires_two_factor_authentication is True

    assert result.status == credential_service.SyncStatus.COMPLETED


def test_sync_leaves_two_factor_flag_unset_without_two_factor(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    monkeypatch.setattr(target=Credential, name="sync", value=lambda self, handler: None)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential_service.sync_credential_object(credential=credential)
        assert credential.requires_two_factor_authentication is False


def test_sync_reraises_reauth_when_handler_has_no_interactive_challenge(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def raise_reauth(self: Credential, handler: BankHandler) -> None:
        raise ReauthenticationRequiredError("expired")

    monkeypatch.setattr(target=Credential, name="sync", value=raise_reauth)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        with pytest.raises(ReauthenticationRequiredError):
            credential_service.sync_credential_object(credential=credential)


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
    monkeypatch.setattr(target=trade_republic_login, name="start", value=start_login)

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
    monkeypatch.setattr(target=trade_republic_login, name="complete", value=complete_login)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        result = credential_service.confirm_two_factor(
            db_session=session, credential_id=credential_id, challenge_token=CHALLENGE_TOKEN, code="0000"
        )

    assert result.status == credential_service.SyncStatus.COMPLETED
    complete_login.assert_called_once_with(challenge_token=CHALLENGE_TOKEN, credential_id=credential_id, code="0000")
    with session_factory() as session:
        assert session.get(entity=Credential, ident=credential_id).session_state == {"cookies": "cookies-from-2fa"}


def test_create_generic_fints_credential_persists_blz(session_factory: sessionmaker) -> None:
    user_id = create_user(session_factory).id

    with session_factory() as session:
        credential = credential_service.create_credential(
            session,
            user_id=user_id,
            bank=BankProvider.FINTS,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": "70150000"},
        )
        session.commit()

    assert credential.bank == BankProvider.FINTS
    assert credential.credentials == {"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": "70150000"}


def test_create_generic_fints_credential_rejects_missing_blz(session_factory: sessionmaker) -> None:
    user_id = create_user(session_factory).id

    with session_factory() as session:
        with pytest.raises(MissingCredentialFieldError):
            credential_service.create_credential(
                session,
                user_id=user_id,
                bank=BankProvider.FINTS,
                credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
            )


def test_sync_all_due_credentials_logs_exception_per_failure(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    user_id = create_user(session_factory).id
    failing = persist_credential(session_factory, user_id=user_id)

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
