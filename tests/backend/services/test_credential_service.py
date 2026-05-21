from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import MissingCredentialFieldError
from source.backend.models.credential import Credential
from source.backend.models.user import User
from source.backend.services import credential_service
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD_HASH,
)


def _create_user(session_factory: sessionmaker, user_name: str = USER_NAME) -> int:
    with session_factory() as session:
        user = User(user_name=user_name, display_name=DISPLAY_NAME, password_hash=VALID_PASSWORD_HASH)
        session.add(user)
        session.commit()
        return user.id


def _create_ing_credential(session_factory: sessionmaker, user_id: int, requires_2fa: bool = False) -> int:
    with session_factory() as session:
        credential = Credential(
            user_id=user_id,
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
            requires_two_factor_authentication=requires_2fa,
        )
        session.add(credential)
        session.commit()
        return credential.id


def test_validated_credentials_rejects_unexpected_fields():
    with pytest.raises(MissingCredentialFieldError, match="Unexpected field"):
        credential_service._validated_credentials(
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD, "bonus_field": "x"},
        )


def test_validated_credentials_rejects_missing_required_field():
    with pytest.raises(MissingCredentialFieldError, match="Missing required field"):
        credential_service._validated_credentials(bank=BankProvider.ING, credentials={"username": BANK_USERNAME})


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
    assert "1 synced, 1 skipped (2FA), 1 failed out of 3 credential(s)" in summary[-1]
    assert credential_service.sync_credential_object.call_count == 2
    synced_ids = [call.kwargs["credential"].id for call in credential_service.sync_credential_object.call_args_list]
    assert two_factor not in synced_ids
    assert {syncable, failing} == set(synced_ids)


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
