from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.bank_handlers.base import BankHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler
from source.backend.exceptions import (
    CredentialAlreadyExistsError,
    CredentialNotFoundError,
    InvalidCredentialFieldError,
    InvalidCredentialsError,
    JobErrorCode,
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.services.banking import credential_service, trade_republic_login
from source.backend.services.notifications import notification_engine
from tests.backend.conftest import (
    APPLICATION_ID,
    BANK_PASSWORD,
    BANK_USERNAME,
    CHALLENGE_TOKEN,
    HTTP_SESSION_TOKEN,
    PHONE_NUMBER,
    PIN,
    SECOND_USER_NAME,
    TWO_FACTOR_CODE,
    VALID_PASSWORD,
    assert_log_contains,
    create_user,
    make_credential,
    make_user,
    persist_credential,
)


@pytest.mark.parametrize(
    argnames=("credentials", "expected_match", "expected_log"),
    argvalues=[
        (
            {"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": "50010517", "bonus_field": "x"},
            "Unexpected field",
            "Unexpected field(s) for",
        ),
        ({"username": BANK_USERNAME}, "Missing required field", "Missing required field(s) for"),
    ],
)
def test_validated_credentials_rejects_invalid_fints_field_set(
    caplog: pytest.LogCaptureFixture, credentials: dict, expected_match: str, expected_log: str
):
    with pytest.raises(MissingCredentialFieldError, match=expected_match):
        credential_service._validate_credentials(bank=BankProvider.FINTS, credentials=credentials)

    assert_log_contains(caplog, message=expected_log)


def test_validate_credentials_strips_whitespace_for_trade_republic():
    cleaned = credential_service._validate_credentials(
        bank=BankProvider.TRADE_REPUBLIC,
        credentials={"phone": "+49 151 23 45", "pin": PIN},
    )
    assert cleaned == {"phone": "+491512345", "pin": PIN}


@pytest.mark.parametrize(
    argnames=("credentials", "expected_log"),
    argvalues=[
        ({"phone": "491512345", "pin": PIN}, None),
        ({"phone": "01512345", "pin": PIN}, None),
        ({"phone": PHONE_NUMBER, "pin": "12"}, "The pin must"),
    ],
)
def test_validate_credentials_rejects_invalid_trade_republic_field(
    caplog: pytest.LogCaptureFixture, credentials: dict, expected_log: str | None
):
    with pytest.raises(InvalidCredentialFieldError):
        credential_service._validate_credentials(bank=BankProvider.TRADE_REPUBLIC, credentials=credentials)

    if expected_log:
        assert_log_contains(caplog, message=expected_log)


def test_validate_credentials_strips_whitespace_from_fints_blz():
    cleaned = credential_service._validate_credentials(
        bank=BankProvider.FINTS,
        credentials={"username": BANK_USERNAME, "password": VALID_PASSWORD, "blz": "660 501 01"},
    )
    assert cleaned["blz"] == "66050101"
    assert cleaned["password"] == VALID_PASSWORD  # this contains spaces which should not be stripped


def test_get_credential_logs_and_raises_for_an_unknown_id(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as session:
        with pytest.raises(CredentialNotFoundError):
            credential_service.get_credential(db_session=session, credential_id=12345)

    assert_log_contains(caplog, message="Credential with the ID 12345 not found")


def test_get_credential_for_user_logs_and_raises_for_a_foreign_credential(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    owner_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=owner_id)

    with session_factory() as session:
        other_user = make_user(session, user_name=SECOND_USER_NAME)
        session.commit()
        with pytest.raises(CredentialNotFoundError):
            credential_service.get_credential_for_user(db_session=session, credential_id=credential_id, user=other_user)

    assert_log_contains(caplog, message="attempted to access <Credential(")


def test_delete_credential_logs_the_deletion(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential_service.delete_credential(db_session=session, credential=credential)

    assert_log_contains(caplog, messages=["Deleted", "<Credential("])


def test_sync_all_due_credentials_counts_synced_skipped_failed(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    user_id = create_user(session_factory).id
    syncable = persist_credential(session_factory, user_id=user_id)
    two_factor = persist_credential(session_factory, user_id=user_id, requires_two_factor_authentication=True)
    sync_disabled = persist_credential(session_factory, user_id=user_id, sync_enabled=False)
    manual = persist_credential(session_factory, user_id=user_id, bank=BankProvider.MANUAL)
    failing = persist_credential(session_factory, user_id=user_id)

    def fake_sync(credential: Credential):
        if credential.id == failing:
            raise RuntimeError("bank is not reachable")
        return credential_service.SyncResult(status=credential_service.SyncStatus.COMPLETED)

    monkeypatch.setattr(
        target=credential_service, name="sync_credential_object", value=MagicMock(side_effect=fake_sync)
    )

    with session_factory() as session:
        credential_service.sync_all_due_credentials(db_session=session)

    assert_log_contains(caplog, message="Starting periodic sync of all due credentials")
    assert_log_contains(caplog, message="1 synced, 3 skipped (2FA or sync disabled), 1 failed out of 5 credential(s)")
    assert credential_service.sync_credential_object.call_count == 2
    synced_ids = [call.kwargs["credential"].id for call in credential_service.sync_credential_object.call_args_list]
    assert two_factor not in synced_ids
    assert sync_disabled not in synced_ids
    assert manual not in synced_ids
    assert {syncable, failing} == set(synced_ids)


def test_sync_credential_loads_by_id_and_returns_completed_for_handler_without_2fa(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        result = credential_service.sync_credential(db_session=session, credential_id=credential_id)

    assert result.status == credential_service.SyncStatus.COMPLETED
    assert result.challenge_token is None
    assert_log_contains(caplog, messages=["Syncing", "Synced"])


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


def test_sync_credential_object_records_the_failure_and_clears_it_on_the_next_success(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def failing_sync(self: Credential, handler: BankHandler) -> None:
        raise InvalidCredentialsError("the bank rejected the login")

    monkeypatch.setattr(target=Credential, name="sync", value=failing_sync)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        with pytest.raises(InvalidCredentialsError):
            credential_service.sync_credential_object(credential=credential)

        assert credential.last_sync_error == "InvalidCredentialsError: the bank rejected the login"
        assert credential.last_sync_error_code == JobErrorCode.INVALID_CREDENTIALS

        monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())
        credential_service.sync_credential_object(credential=credential)

        assert credential.last_sync_error is None
        assert credential.last_sync_error_code is None


def test_sync_credential_object_records_a_failure_raised_while_starting_the_2fa_challenge(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def failing_sync(self: Credential, handler: BankHandler) -> None:
        raise ReauthenticationRequiredError("access has not been authorized yet")

    def failing_challenge(self: BankHandler, credential_id: int) -> None:
        # What Enable Banking does when its application credentials went missing.
        raise KeyError("application_id")

    monkeypatch.setattr(target=Credential, name="sync", value=failing_sync)
    monkeypatch.setattr(target=BankHandler, name="begin_two_factor_challenge", value=failing_challenge)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        with pytest.raises(KeyError):
            credential_service.sync_credential_object(credential=credential)

    # The failure escapes from inside the 2FA handler, which a sibling `except` clause would miss.
    assert credential.last_sync_error == (
        "ReauthenticationRequiredError: access has not been authorized yet\nKeyError: 'application_id'"
    )
    assert credential.last_sync_error_code == JobErrorCode.UNKNOWN


def test_sync_credential_object_records_the_failure_when_no_2fa_challenge_can_be_started(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def failing_sync(self: Credential, handler: BankHandler) -> None:
        raise ReauthenticationRequiredError("access has not been authorized yet")

    monkeypatch.setattr(target=Credential, name="sync", value=failing_sync)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        # The base handler starts no challenge, so the error is re-raised from inside the except block.
        with pytest.raises(ReauthenticationRequiredError):
            credential_service.sync_credential_object(credential=credential)

    assert credential.last_sync_error == "ReauthenticationRequiredError: access has not been authorized yet"


def _store_sync_failure(session_factory: sessionmaker, credential_id: int) -> None:
    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.last_sync_error = "InvalidCredentialsError: the bank rejected the login"
        credential.last_sync_error_code = JobErrorCode.INVALID_CREDENTIALS
        session.commit()


def _stored_sync_failure(session_factory: sessionmaker, credential_id: int) -> tuple[str | None, JobErrorCode | None]:
    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        return credential.last_sync_error, credential.last_sync_error_code


def test_sync_credential_commits_the_cleared_failure_after_a_successful_manual_sync(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)
    _store_sync_failure(session_factory, credential_id=credential_id)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        credential_service.sync_credential(db_session=session, credential_id=credential_id)

    assert _stored_sync_failure(session_factory, credential_id=credential_id) == (None, None)


def test_sync_all_due_credentials_commits_the_cleared_failure_after_a_successful_periodic_sync(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)
    _store_sync_failure(session_factory, credential_id=credential_id)
    monkeypatch.setattr(target=Credential, name="sync", value=MagicMock())

    with session_factory() as session:
        credential_service.sync_all_due_credentials(db_session=session)

    assert _stored_sync_failure(session_factory, credential_id=credential_id) == (None, None)


def test_sync_credential_object_records_every_message_of_a_chained_failure(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def failing_sync(self: Credential, handler: BankHandler) -> None:
        # The shape the Enable Banking handler produces: a bare KeyError while handling the real cause.
        try:
            raise ReauthenticationRequiredError("access has not been authorized yet")
        except ReauthenticationRequiredError:
            raise KeyError("application_id")

    monkeypatch.setattr(target=Credential, name="sync", value=failing_sync)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        with pytest.raises(KeyError):
            credential_service.sync_credential_object(credential=credential)

    assert credential.last_sync_error == (
        "ReauthenticationRequiredError: access has not been authorized yet\nKeyError: 'application_id'"
    )


def test_sync_all_due_credentials_notifies_only_on_the_first_of_repeated_failures(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    def fake_sync(credential: Credential):
        # Mirrors what the real sync_credential_object records before the error propagates.
        credential.last_sync_error = "the bank rejected the login"
        credential.last_sync_error_code = JobErrorCode.INVALID_CREDENTIALS
        raise InvalidCredentialsError("the bank rejected the login")

    monkeypatch.setattr(
        target=credential_service, name="sync_credential_object", value=MagicMock(side_effect=fake_sync)
    )
    dispatch = MagicMock()
    monkeypatch.setattr(target=notification_engine, name="dispatch", value=dispatch)

    with session_factory() as session:
        credential_service.sync_all_due_credentials(db_session=session)
        credential_service.sync_all_due_credentials(db_session=session)

    assert dispatch.call_count == 1
    notification = dispatch.call_args.kwargs["notifications"][0]
    assert notification.tag == f"credential-sync-failed-{credential_id}"
    assert notification.url == f"/settings/credentials/{credential_id}"


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
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
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
        result = credential_service.sync_credential_object(
            credential=credential, reevaluate_two_factor_requirement=True
        )
        assert credential.requires_two_factor_authentication is True

    assert result.status == credential_service.SyncStatus.COMPLETED
    assert_log_contains(caplog, message="2FA requirement re-evaluated: False -> True")


def test_sync_leaves_two_factor_flag_unset_without_two_factor(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(session_factory, user_id=user_id)

    monkeypatch.setattr(target=Credential, name="sync", value=lambda self, handler: None)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential_service.sync_credential_object(credential=credential, reevaluate_two_factor_requirement=True)
        assert not credential.requires_two_factor_authentication


@pytest.mark.parametrize(
    argnames="hours_since_last_fetch, reevaluate, expected_flag",
    argvalues=[
        (25, True, False),  # stale enough and reevaluation requested -> flag cleared
        (1, True, True),  # previous fetch too recent to reevaluate -> flag kept
        (48, False, True),  # no reevaluation requested -> flag untouched
    ],
)
def test_sync_reevaluates_two_factor_flag(
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    hours_since_last_fetch: int,
    reevaluate: bool,
    expected_flag: bool,
):
    user_id = create_user(session_factory).id
    credential_id = persist_credential(
        session_factory,
        user_id=user_id,
        requires_two_factor_authentication=True,
        last_fetching_timestamp=datetime.now(timezone.utc).replace(tzinfo=None)
        - timedelta(hours=hours_since_last_fetch),
    )

    monkeypatch.setattr(target=Credential, name="sync", value=lambda self, handler: None)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential_service.sync_credential_object(credential=credential, reevaluate_two_factor_requirement=reevaluate)
        assert credential.requires_two_factor_authentication is expected_flag


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
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
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
    assert_log_contains(caplog, message="requires 2FA re-authentication; started interactive challenge")


def test_confirm_two_factor_completes_login_and_syncs_credential(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
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
            db_session=session, credential_id=credential_id, challenge_token=CHALLENGE_TOKEN, code=TWO_FACTOR_CODE
        )

    assert result.status == credential_service.SyncStatus.COMPLETED
    complete_login.assert_called_once_with(
        challenge_token=CHALLENGE_TOKEN, credential_id=credential_id, code=TWO_FACTOR_CODE
    )
    with session_factory() as session:
        assert session.get(entity=Credential, ident=credential_id).session_state == {"cookies": "cookies-from-2fa"}
    assert_log_contains(caplog, message="Confirming 2FA for")


def test_create_generic_fints_credential_persists_blz(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        credential = credential_service.create_credential(
            session,
            user=user,
            bank=BankProvider.FINTS,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": "70150000"},
        )
        session.commit()

    assert credential.bank == BankProvider.FINTS
    assert credential.credentials == {"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": "70150000"}
    assert_log_contains(caplog, messages=["Created", "<Credential("])
    assert BANK_PASSWORD not in caplog.text


def test_create_generic_fints_credential_rejects_a_duplicate(session_factory: sessionmaker):
    user_id = create_user(session_factory).id
    credentials = {"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": "70150000"}

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        credential_service.create_credential(session, user=user, bank=BankProvider.FINTS, credentials=credentials)
        session.commit()

        with pytest.raises(CredentialAlreadyExistsError):
            credential_service.create_credential(
                session, user=user, bank=BankProvider.FINTS, credentials=dict(credentials)
            )


def test_create_scalable_capital_credential_allows_a_second_attempt_after_the_first(
    session_factory: sessionmaker,
):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        first = credential_service.create_credential(
            session, user=user, bank=BankProvider.SCALABLE_CAPITAL, credentials={}
        )
        session.commit()

        second = credential_service.create_credential(
            session, user=user, bank=BankProvider.SCALABLE_CAPITAL, credentials={}
        )
        session.commit()

    assert first.id != second.id


def test_create_generic_fints_credential_rejects_missing_blz(session_factory: sessionmaker):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        with pytest.raises(MissingCredentialFieldError):
            credential_service.create_credential(
                session,
                user=user,
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

    with session_factory() as session:
        credential_service.sync_all_due_credentials(db_session=session)

    assert_log_contains(caplog, messages=["Periodic sync failed", f"id={failing}"])


_ENABLE_BANKING_APP = {
    "application_id": APPLICATION_ID,
    "private_key": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    "redirect_url": "https://localhost:8000/banking/callback",
}


def test_create_enable_banking_credential_inherits_the_application_from_an_existing_one(
    session_factory: sessionmaker,
):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        credential_service.create_credential(
            session,
            user=user,
            bank=BankProvider.ENABLE_BANKING,
            credentials={**_ENABLE_BANKING_APP, "aspsp_name": "PayPal", "aspsp_country": "DE"},
        )
        session.commit()

        second = credential_service.create_credential(
            session,
            user=user,
            bank=BankProvider.ENABLE_BANKING,
            credentials={
                "redirect_url": _ENABLE_BANKING_APP["redirect_url"],
                "aspsp_name": "ING",
                "aspsp_country": "DE",
            },
        )
        session.commit()

    assert second.credentials["application_id"] == _ENABLE_BANKING_APP["application_id"]
    assert second.credentials["private_key"] == _ENABLE_BANKING_APP["private_key"]
    assert second.credentials["aspsp_name"] == "ING"


def test_create_enable_banking_credential_extracts_the_application_id_from_the_key_file_name(
    session_factory: sessionmaker,
):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        credential = credential_service.create_credential(
            session,
            user=user,
            bank=BankProvider.ENABLE_BANKING,
            credentials={
                "private_key": _ENABLE_BANKING_APP["private_key"],
                "private_key_file_name": "AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee.pem",
                "redirect_url": _ENABLE_BANKING_APP["redirect_url"],
                "aspsp_name": "PayPal",
                "aspsp_country": "DE",
            },
        )
        session.commit()

    assert credential.credentials["application_id"] == APPLICATION_ID
    assert "private_key_file_name" not in credential.credentials


def test_create_enable_banking_credential_rejects_a_non_https_redirect_url(session_factory: sessionmaker):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        with pytest.raises(InvalidCredentialFieldError):
            credential_service.create_credential(
                session,
                user=user,
                bank=BankProvider.ENABLE_BANKING,
                credentials={
                    **_ENABLE_BANKING_APP,
                    "redirect_url": "http://localhost:8000/banking/callback",
                    "aspsp_name": "PayPal",
                    "aspsp_country": "DE",
                },
            )


def test_create_enable_banking_credential_without_existing_application_requires_the_fields(
    session_factory: sessionmaker,
):
    user_id = create_user(session_factory).id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        with pytest.raises(MissingCredentialFieldError):
            credential_service.create_credential(
                session,
                user=user,
                bank=BankProvider.ENABLE_BANKING,
                credentials={
                    "redirect_url": _ENABLE_BANKING_APP["redirect_url"],
                    "aspsp_name": "ING",
                    "aspsp_country": "DE",
                },
            )
