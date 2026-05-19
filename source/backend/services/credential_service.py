from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from source.backend.bank_handlers import BANKS_BY_NAME, SUPPORTED_BANKS, BankProvider
from source.backend.bank_handlers.fints_handler import FinTSHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler
from source.backend.exceptions import (
    CredentialNotFoundError,
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.credential import Credential
from source.backend.services import (
    application_secret_service,
    trade_republic_login,
    user_service,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


class SyncStatus(str, Enum):
    COMPLETED = "completed"
    TWO_FACTOR_REQUIRED = "2fa_required"


@dataclass
class SyncResult:
    status: SyncStatus
    challenge_token: str | None = None
    expires_at: datetime | None = None


def list_all_possible() -> list[dict]:
    return [bank.information_for_user for bank in SUPPORTED_BANKS]


def list_credentials(db_session: Session, user_id: int) -> list[Credential]:
    credentials = list(db_session.scalars(select(Credential).where(Credential.user_id == user_id)))
    logger.debug(f"Found {len(credentials)} credential(s) for user {user_id}")
    return credentials


def get_credential(db_session: Session, credential_id: int) -> Credential:
    credential = db_session.get(entity=Credential, ident=credential_id)
    if credential is None:
        error_message = f"Credential with the ID {credential_id} not found"
        logger.warning(error_message)
        raise CredentialNotFoundError(error_message)
    logger.debug(f"Loaded credential with the ID {credential_id} ({credential.bank.value})")
    return credential


def get_credential_for_user(db_session: Session, credential_id: int, user_id: int) -> Credential:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    if credential.user_id != user_id:
        logger.warning(
            f"User {user_id} attempted to access credential {credential_id} owned by user {credential.user_id}"
        )
        raise CredentialNotFoundError(f"Credential with the ID {credential_id} not found")
    return credential


def _validated_credentials(bank: BankProvider, credentials: dict[str, str]) -> dict[str, str]:
    required = BANKS_BY_NAME[bank.value].handler.CREDENTIAL_FIELDS
    missing = [field for field in required if not credentials.get(field)]
    if missing:
        error_message = f"Missing required field(s) for {bank.value}: {', '.join(missing)}"
        logger.warning(error_message)
        raise MissingCredentialFieldError(error_message)
    unexpected = [field for field in credentials if field not in required]
    if unexpected:
        error_message = f"Unexpected field(s) for {bank.value}: {', '.join(sorted(unexpected))}"
        logger.warning(error_message)
        raise MissingCredentialFieldError(error_message)
    return {field: credentials[field] for field in required}


def create_credential(
    db_session: Session,
    user_id: int,
    bank: BankProvider,
    credentials: dict[str, str],
) -> Credential:
    user = user_service.get_user_by_id(db_session=db_session, user_id=user_id)
    credential = Credential(
        user=user,
        bank=bank,
        credentials=_validated_credentials(bank=bank, credentials=credentials),
    )
    db_session.add(credential)
    db_session.commit()
    logger.info(f"Created credential with the ID {credential.id} ({bank.value}) for user {user_id}")
    return credential


def update_credential(db_session: Session, credential_id: int, fields: dict) -> Credential:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    for key, value in fields.items():
        setattr(credential, key, value)
    db_session.commit()
    logger.info(f"Updated credential with the ID {credential_id}, fields: {sorted(fields)}")
    return credential


def delete_credential(db_session: Session, credential_id: int) -> None:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    db_session.delete(credential)
    db_session.commit()
    logger.info(f"Deleted credential with the ID {credential_id}")


def sync_credential(db_session: Session, credential_id: int) -> SyncResult:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    result = sync_credential_object(db_session=db_session, credential=credential)
    db_session.commit()
    return result


def sync_credential_object(db_session: Session, credential: Credential) -> SyncResult:
    logger.info(f"Syncing credential with the ID {credential.id} ({credential.bank.value})")
    handler = credential.handler
    logger.debug(f"Using {type(handler).__name__} for credential {credential.id}")
    if isinstance(handler, FinTSHandler):
        handler.product_id = application_secret_service.get_value_of_application_secret_by_name(
            name=FinTSHandler.PRODUCT_ID_SECRET_NAME, db_session=db_session
        )
        logger.debug(f"Loaded FinTS product id from application secret for credential {credential.id}")
    if isinstance(handler, TradeRepublicHandler):
        handler.session_state = credential.session_state
        logger.debug(
            f"Credential {credential.id} has {'a stored' if credential.session_state else 'no'} Trade Republic session"
        )
        try:
            credential.sync(handler)
        except ReauthenticationRequiredError:
            logger.info(f"Credential {credential.id} requires 2FA re-authentication; starting Trade Republic login")
            token, expires_at = trade_republic_login.start(
                credential_id=credential.id,
                phone_no=handler.credentials["phone"],
                pin=handler.credentials["pin"],
            )
            credential.requires_two_factor_authentication = True
            return SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=token, expires_at=expires_at)
        credential.session_state = handler.session_state
        logger.info(f"Credential with the ID {credential.id} synced (Trade Republic, resumed session)")
        return SyncResult(status=SyncStatus.COMPLETED)

    credential.sync(handler)
    logger.info(f"Credential with the ID {credential.id} synced ({credential.bank.value})")
    return SyncResult(status=SyncStatus.COMPLETED)


def confirm_two_factor(db_session: Session, credential_id: int, challenge_token: str, code: str) -> SyncResult:
    logger.info(f"Confirming 2FA for credential {credential_id}")
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    cookies = trade_republic_login.complete(challenge_token=challenge_token, credential_id=credential_id, code=code)
    credential.session_state = {"cookies": cookies}
    result = sync_credential_object(db_session=db_session, credential=credential)
    db_session.commit()
    return result
