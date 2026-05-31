import re
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from source.backend.bank_handlers import BANKS_BY_NAME, SUPPORTED_BANKS, BankProvider
from source.backend.bank_handlers.base import TwoFactorStateCallback
from source.backend.exceptions import (
    CredentialAlreadyExistsError,
    CredentialNotFoundError,
    InvalidCredentialFieldError,
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.credential import Credential
from source.backend.services import user_service
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
    logger.debug(f"Loaded {credential}")
    return credential


def get_credential_for_user(db_session: Session, credential_id: int, user_id: int) -> Credential:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    if credential.user_id != user_id:
        logger.warning(f"User {user_id} attempted to access {credential} owned by user {credential.user_id}")
        raise CredentialNotFoundError(f"Credential with the ID {credential_id} not found")
    return credential


def _validate_credentials(bank: BankProvider, credentials: dict[str, str]) -> dict[str, str]:
    bank_info = BANKS_BY_NAME[bank.value]
    handler = bank_info.handler
    required_fields = handler.credential_fields(bank_info)
    missing = [field for field in required_fields if not credentials.get(field)]
    if missing:
        error_message = f"Missing required field(s) for {bank.value}: {', '.join(missing)}"
        logger.warning(error_message)
        raise MissingCredentialFieldError(error_message)
    unexpected = [field for field in credentials if field not in required_fields]
    if unexpected:
        error_message = f"Unexpected field(s) for {bank.value}: {', '.join(sorted(unexpected))}"
        logger.warning(error_message)
        raise MissingCredentialFieldError(error_message)

    cleaned: dict[str, str] = {}
    for field in required_fields:
        value = credentials[field]
        if field in handler.WHITESPACE_STRIPPED_FIELDS:
            value = re.sub(pattern=r"\s+", repl="", string=value)
        for rule in handler.FIELD_RULES.get(field, ()):  # noqa FKA100
            if not re.search(pattern=rule.regex, string=value):
                error_message = f"The {field} must {rule.description}"
                logger.warning(error_message)
                raise InvalidCredentialFieldError(error_message)
        cleaned[field] = value
    return cleaned


def create_credential(
    db_session: Session,
    user_id: int,
    bank: BankProvider,
    credentials: dict[str, str],
) -> Credential:
    user = user_service.get_user_by_id(db_session=db_session, user_id=user_id)
    validated_credentials = _validate_credentials(bank=bank, credentials=credentials)

    if bank != BankProvider.MANUAL:
        existing_credentials = db_session.scalars(
            select(Credential).where(Credential.user_id == user_id).where(Credential.bank == bank)
        ).all()
        if any(
            existing_credential.credentials == validated_credentials for existing_credential in existing_credentials
        ):
            raise CredentialAlreadyExistsError(
                f"User {user_id} already has a {bank.value} credential with the same login data"
            )
    credential = Credential(user=user, bank=bank, credentials=validated_credentials)
    db_session.add(credential)
    db_session.commit()
    logger.info(f"Created credential {credential}")
    return credential


def update_credential(db_session: Session, credential_id: int, fields: dict) -> Credential:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    credential_before_change = str(credential)
    for key, value in fields.items():
        setattr(credential, key, value)
    db_session.commit()
    logger.info(f"Updated credential {credential_before_change} --> {credential}")
    return credential


def delete_credential(db_session: Session, credential_id: int) -> None:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    db_session.delete(credential)
    db_session.commit()
    logger.info(f"Deleted credential {credential}")


def sync_credential(
    db_session: Session,
    credential_id: int,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
) -> SyncResult:
    logger.debug(f"Sync requested for credential {credential_id}")
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    result = sync_credential_object(credential=credential, notify_two_factor_state=notify_two_factor_state)
    db_session.commit()
    return result


def sync_credential_object(
    credential: Credential,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
) -> SyncResult:
    logger.info(f"Syncing {credential}")
    handler = credential.handler
    logger.debug(f"Using {type(handler).__name__} for {credential}")

    two_factor_used = False

    def track_two_factor_state(awaiting: bool) -> None:
        nonlocal two_factor_used
        if awaiting:
            two_factor_used = True
        if notify_two_factor_state is not None:
            notify_two_factor_state(awaiting)

    handler.notify_two_factor_state = track_two_factor_state
    handler.session_state = credential.session_state

    try:
        credential.sync(handler)
    except ReauthenticationRequiredError:
        challenge = handler.begin_two_factor_challenge(credential_id=credential.id)
        if challenge is None:
            raise
        logger.info(f"{credential} requires 2FA re-authentication; started interactive challenge")
        credential.requires_two_factor_authentication = True
        return SyncResult(
            status=SyncStatus.TWO_FACTOR_REQUIRED,
            challenge_token=challenge.challenge_token,
            expires_at=challenge.expires_at,
        )

    credential.session_state = handler.session_state
    if two_factor_used:
        credential.requires_two_factor_authentication = True
    logger.info(f"Synced {credential}")
    return SyncResult(status=SyncStatus.COMPLETED)


def sync_all_due_credentials(db_session: Session) -> None:
    logger.info("Starting periodic sync of all due credentials")
    credentials = list(db_session.scalars(select(Credential)))
    synced, skipped, failed = 0, 0, 0
    for credential in credentials:
        if credential.requires_two_factor_authentication:
            skipped += 1
            continue

        try:
            sync_credential_object(credential=credential)
            synced += 1
        except Exception:
            failed += 1
            logger.exception(f"Periodic sync failed for {credential}")
    db_session.commit()
    logger.info(
        f"Periodic sync finished: {synced} synced, {skipped} skipped due to 2FA, "
        f"{failed} failed out of {len(credentials)} credential(s)"
    )


def confirm_two_factor(db_session: Session, credential_id: int, challenge_token: str, code: str) -> SyncResult:
    logger.info(f"Confirming 2FA for credential {credential_id}")
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    credential.session_state = credential.handler.complete_two_factor_challenge(
        challenge_token=challenge_token, credential_id=credential_id, code=code
    )
    result = sync_credential_object(credential=credential)
    db_session.commit()
    return result
