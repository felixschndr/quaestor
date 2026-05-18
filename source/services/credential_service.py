from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from source.bank_handlers import BANKS_BY_NAME, SUPPORTED_BANKS, BankProvider
from source.bank_handlers.fints_handler import FinTSHandler
from source.bank_handlers.trade_republic import TradeRepublicHandler
from source.exceptions import (
    CredentialNotFoundError,
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.models.credential import Credential
from source.services import (
    application_secret_service,
    trade_republic_login,
    user_service,
)
from sqlalchemy import select
from sqlalchemy.orm import Session


class SyncStatus(str, Enum):
    COMPLETED = "completed"
    TWO_FACTOR_REQUIRED = "2fa_required"


@dataclass
class SyncResult:
    status: SyncStatus
    challenge_token: str | None = None
    expires_at: datetime | None = None


def list_all_possible() -> list[dict]:
    return [
        {
            "Bank Name": bank.name,
            "Bank Identifier": bank.bank_identifier,
            "Required Fields": bank.required_fields,
        }
        for bank in SUPPORTED_BANKS
    ]


def list_credentials(session: Session, user_id: int) -> list[Credential]:
    return list(session.scalars(select(Credential).where(Credential.user_id == user_id)))


def get_credential(session: Session, credential_id: int) -> Credential:
    credential = session.get(Credential, credential_id)
    if credential is None:
        raise CredentialNotFoundError(f"Credential with the id {credential_id} not found")
    return credential


def _validated_extra(bank: BankProvider, extra: dict[str, str]) -> dict[str, str]:
    required = BANKS_BY_NAME[bank.value].handler.EXTRA_CREDENTIAL_FIELDS
    missing = [field for field in required if not extra.get(field)]
    if missing:
        raise MissingCredentialFieldError(f"Missing required field(s) for {bank.value}: {', '.join(missing)}")
    return {field: extra[field] for field in required}


def create_credential(
    session: Session,
    user_id: int,
    bank: BankProvider,
    username: str,
    password: str,
    extra: dict[str, str] | None = None,
) -> Credential:
    user = user_service.get_user(session, user_id)
    credential = Credential(
        user=user,
        bank=bank,
        username=username,
        password=password,
        extra=_validated_extra(bank, extra or {}),
    )
    session.add(credential)
    session.commit()
    return credential


def update_credential(session: Session, credential_id: int, fields: dict) -> Credential:
    credential = get_credential(session, credential_id)
    for key, value in fields.items():
        setattr(credential, key, value)
    session.commit()
    return credential


def delete_credential(session: Session, credential_id: int) -> None:
    credential = get_credential(session, credential_id)
    session.delete(credential)
    session.commit()


def sync_credential(session: Session, credential_id: int) -> SyncResult:
    credential = get_credential(session, credential_id)
    result = sync_credential_object(session, credential)
    session.commit()
    return result


def sync_credential_object(session: Session, credential: Credential) -> SyncResult:
    handler = credential.handler
    if isinstance(handler, FinTSHandler):
        handler.product_id = application_secret_service.get_value_of_application_secret_by_name(
            FinTSHandler.PRODUCT_ID_SECRET_NAME, session
        )
    if isinstance(handler, TradeRepublicHandler):
        handler.session_state = credential.session_state
        try:
            credential.sync(handler)
        except ReauthenticationRequiredError:
            token, expires_at = trade_republic_login.start(credential.id, handler.username, handler.password)
            return SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=token, expires_at=expires_at)
        credential.session_state = handler.session_state
        return SyncResult(status=SyncStatus.COMPLETED)

    credential.sync(handler)
    return SyncResult(status=SyncStatus.COMPLETED)


def confirm_two_factor(session: Session, credential_id: int, challenge_token: str, code: str) -> SyncResult:
    credential = get_credential(session, credential_id)
    cookies = trade_republic_login.complete(challenge_token, credential_id, code)
    credential.session_state = {"cookies": cookies}
    result = sync_credential_object(session, credential)
    session.commit()
    return result
