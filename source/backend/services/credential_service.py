import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum

from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider
from source.backend.bank_handlers.base import TwoFactorStateCallback
from source.backend.exceptions import (
    CredentialAlreadyExistsError,
    CredentialNotFoundError,
    InvalidCredentialFieldError,
    MissingCredentialFieldError,
    ReauthenticationRequiredError,
)
from source.backend.helpers import apply_fields, utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.base import snapshot_columns
from source.backend.models.credential import Credential
from source.backend.models.user import User
from source.backend.services import (
    bank_catalog,
    contract_detection_service,
    notification_engine,
    transfer_detection,
)
from source.backend.services.notification_service import Notification
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

TWO_FACTOR_REEVALUATION_MIN_GAP = timedelta(hours=24)


class SyncStatus(str, Enum):
    COMPLETED = "completed"
    TWO_FACTOR_REQUIRED = "2fa_required"


@dataclass
class SyncResult:
    status: SyncStatus
    challenge_token: str | None = None
    expires_at: datetime | None = None


def list_all_possible() -> list[dict]:
    return bank_catalog.get_catalog()


def list_credentials(db_session: Session, user: User) -> list[Credential]:
    credentials = list(db_session.scalars(select(Credential).where(Credential.user_id == user.id)))
    logger.debug(f"Found {len(credentials)} credential(s) for {user}")
    return credentials


def get_credential(db_session: Session, credential_id: int) -> Credential:
    credential = db_session.get(entity=Credential, ident=credential_id)
    if credential is None:
        error_message = f"Credential with the ID {credential_id} not found"
        logger.warning(error_message)
        raise CredentialNotFoundError(error_message)
    logger.debug(f"Loaded {credential}")
    return credential


def get_credential_for_user(db_session: Session, credential_id: int, user: User) -> Credential:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    if credential.user_id != user.id:
        logger.warning(f"{user} attempted to access {credential} owned by user {credential.user_id}")
        raise CredentialNotFoundError(f"Credential with the ID {credential_id} not found")
    logger.debug(f"{user} accessed {credential}")
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
    user: User,
    bank: BankProvider,
    credentials: dict[str, str],
) -> Credential:
    logger.debug(f"Creating {bank.value} credential for {user}")
    validated_credentials = _validate_credentials(bank=bank, credentials=credentials)

    if bank != BankProvider.MANUAL:
        existing_credentials = db_session.scalars(
            select(Credential).where(Credential.user_id == user.id).where(Credential.bank == bank)
        ).all()
        if any(
            existing_credential.credentials == validated_credentials for existing_credential in existing_credentials
        ):
            raise CredentialAlreadyExistsError(f"{user} already has a {bank.value} credential with the same login data")
    credential = Credential(user=user, bank=bank, credentials=validated_credentials)
    db_session.add(credential)
    db_session.commit()
    logger.info(f"Created {credential} for {user}")
    return credential


def update_credential(db_session: Session, credential: Credential, fields: dict) -> Credential:
    logger.debug(f"Updating {credential} with fields {sorted(fields)}")
    state_before_update = snapshot_columns(credential)
    apply_fields(entity=credential, fields=fields)
    db_session.commit()
    logger.update(state_before_update=state_before_update, entity_after_update=credential)
    return credential


def delete_credential(db_session: Session, credential: Credential) -> None:
    logger.debug(f"Deleting {credential}")
    db_session.delete(credential)
    db_session.commit()
    logger.info(f"Deleted {credential}")


def sync_credential(
    db_session: Session,
    credential_id: int,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
) -> SyncResult:
    logger.debug(f"Sync requested for credential {credential_id}")
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    snapshot = notification_engine.capture_sync_snapshot(credential)
    result = sync_credential_object(
        credential=credential,
        notify_two_factor_state=notify_two_factor_state,
        reevaluate_two_factor_requirement=True,
    )
    notifications: list[Notification] = []
    if result.status == SyncStatus.COMPLETED:
        transfer_detection.detect_transfers_for_user(db_session=db_session, user=credential.user)
        contract_detection_service.detect_contracts_for_user(db_session=db_session, user=credential.user)
        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )
    db_session.commit()

    notification_engine.dispatch(db_session=db_session, user=credential.user, notifications=notifications)

    return result


def sync_credential_object(
    credential: Credential,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
    reevaluate_two_factor_requirement: bool = False,
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

    previous_fetching_timestamp = credential.last_fetching_timestamp

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
    if reevaluate_two_factor_requirement and _should_reevaluate_two_factor(previous_fetching_timestamp):
        if credential.requires_two_factor_authentication != two_factor_used:
            logger.info(
                f"{credential} 2FA requirement re-evaluated: "
                f"{credential.requires_two_factor_authentication} -> {two_factor_used}"
            )
        credential.requires_two_factor_authentication = two_factor_used
    logger.info(f"Synced {credential}")
    return SyncResult(status=SyncStatus.COMPLETED)


def _should_reevaluate_two_factor(previous_fetching_timestamp: datetime | None) -> bool:
    if previous_fetching_timestamp is None:
        return True
    return utc_now() - previous_fetching_timestamp >= TWO_FACTOR_REEVALUATION_MIN_GAP


def sync_all_due_credentials(db_session: Session) -> None:
    logger.info("Starting periodic sync of all due credentials")
    credentials = list(db_session.scalars(select(Credential)))
    synced, skipped, failed = 0, 0, 0
    synced_users: dict[int, User] = {}
    synced_credentials: list[tuple[Credential, notification_engine.SyncSnapshot]] = []
    for credential in credentials:
        if not credential.sync_enabled or credential.requires_two_factor_authentication:
            skipped += 1
            continue

        try:
            snapshot = notification_engine.capture_sync_snapshot(credential)
            sync_credential_object(credential=credential)
            synced += 1
            synced_users[credential.user_id] = credential.user
            synced_credentials.append((credential, snapshot))
        except Exception:
            failed += 1
            logger.exception(f"Periodic sync failed for {credential}")
    for user in synced_users.values():
        transfer_detection.detect_transfers_for_user(db_session=db_session, user=user)
        contract_detection_service.detect_contracts_for_user(db_session=db_session, user=user)
    pending_notifications = [
        (credential.user, notification)
        for credential, snapshot in synced_credentials
        for notification in notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )
    ]
    db_session.commit()

    for user, notification in pending_notifications:
        notification_engine.dispatch(db_session=db_session, user=user, notifications=[notification])

    logger.info(
        f"Periodic sync finished: {synced} synced, {skipped} skipped (2FA or sync disabled), "
        f"{failed} failed out of {len(credentials)} credential(s)"
    )


def confirm_two_factor(db_session: Session, credential_id: int, challenge_token: str, code: str) -> SyncResult:
    credential = get_credential(db_session=db_session, credential_id=credential_id)
    logger.info(f"Confirming 2FA for {credential}")
    credential.session_state = credential.handler.complete_two_factor_challenge(
        challenge_token=challenge_token, credential_id=credential_id, code=code
    )
    snapshot = notification_engine.capture_sync_snapshot(credential)
    result = sync_credential_object(credential=credential)
    notifications: list[Notification] = []
    if result.status == SyncStatus.COMPLETED:
        transfer_detection.detect_transfers_for_user(db_session=db_session, user=credential.user)
        contract_detection_service.detect_contracts_for_user(db_session=db_session, user=credential.user)
        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )
    db_session.commit()
    notification_engine.dispatch(db_session=db_session, user=credential.user, notifications=notifications)
    return result
