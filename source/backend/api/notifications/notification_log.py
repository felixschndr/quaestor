from fastapi import Depends
from sqlalchemy.orm import Session

from source.backend.api.core.create_router import create_router
from source.backend.api.schemas.notifications.notification_log import NotificationLogEntryRead
from source.backend.db import get_session
from source.backend.logging_utils import get_logger
from source.backend.models.auth.user import User
from source.backend.services.auth import session_service
from source.backend.services.notifications import notification_service

router = create_router()
logger = get_logger(__name__)


@router.get("", response_model=list[NotificationLogEntryRead])
def list_entries(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[NotificationLogEntryRead]:
    entries = notification_service.list_log(db_session=db_session, user=current_user)
    logger.debug(f"Listed {len(entries)} notification log entrie(s) for {current_user}")
    return [NotificationLogEntryRead.model_validate(entry) for entry in entries]


@router.post("/read", status_code=204)
def mark_all_read(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    notification_service.mark_all_log_entries_read(db_session=db_session, user=current_user)


@router.post("/{entry_id}/read", response_model=NotificationLogEntryRead)
def mark_read(
    entry_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> NotificationLogEntryRead:
    entry = notification_service.mark_log_entry_read(db_session=db_session, user=current_user, entry_id=entry_id)
    return NotificationLogEntryRead.model_validate(entry)
