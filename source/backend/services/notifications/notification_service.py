from dataclasses import asdict, dataclass, field
from datetime import timedelta
from typing import cast

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.orm import Session

from source.backend.exceptions import NotificationLogEntryNotFoundError
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.auth.user import User
from source.backend.models.notifications.notification_log_entry import NotificationLogEntry
from source.backend.models.notifications.push_subscription import PushSubscription
from source.backend.services.notifications import push_service
from source.backend.services.notifications.push_service import PushOutcome

logger = get_logger(__name__)

LOG_RETENTION = timedelta(days=14)


@dataclass(frozen=True)
class Notification:
    title: str
    body: str
    url: str | None = None
    tag: str | None = None

    def to_payload(self) -> dict:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass
class NotificationResult:
    delivered: int = 0
    pruned: int = 0
    failed: int = 0
    error: str | None = field(default=None)


def log_notification(db_session: Session, user: User, notification: Notification) -> NotificationLogEntry:
    now = utc_now()
    entry = NotificationLogEntry(
        user_id=user.id,
        title=notification.title,
        body=notification.body,
        url=notification.url,
        created_at=now,
    )
    db_session.add(entry)
    pruned = cast(
        CursorResult,
        db_session.execute(
            delete(NotificationLogEntry)
            .where(NotificationLogEntry.user_id == user.id)
            .where(NotificationLogEntry.created_at < now - LOG_RETENTION)
        ),
    )
    removed = pruned.rowcount
    db_session.commit()
    if removed:
        logger.info(f"Pruned {removed} notification log entrie(s) older than {LOG_RETENTION.days} days for {user}")
    return entry


def list_log(db_session: Session, user: User) -> list[NotificationLogEntry]:
    return list(
        db_session.scalars(
            select(NotificationLogEntry)
            .where(NotificationLogEntry.user_id == user.id)
            .where(NotificationLogEntry.created_at >= utc_now() - LOG_RETENTION)
            .order_by(NotificationLogEntry.created_at.desc())
        )
    )


def mark_log_entry_read(db_session: Session, user: User, entry_id: int) -> NotificationLogEntry:
    entry = db_session.get(entity=NotificationLogEntry, ident=entry_id)
    if entry is None or entry.user_id != user.id:
        raise NotificationLogEntryNotFoundError(f"Notification log entry with the ID {entry_id} not found")
    if entry.read_at is None:
        entry.read_at = utc_now()
        db_session.commit()
    return entry


def mark_all_log_entries_read(db_session: Session, user: User) -> int:
    marked = cast(
        CursorResult,
        db_session.execute(
            update(NotificationLogEntry)
            .where(NotificationLogEntry.user_id == user.id)
            .where(NotificationLogEntry.read_at.is_(None))
            .values(read_at=utc_now())
        ),
    ).rowcount
    db_session.commit()
    logger.info(f"Marked {marked} notification log entrie(s) as read for {user}")
    return marked


def notify_user(db_session: Session, user: User, notification: Notification) -> NotificationResult:
    entry = log_notification(db_session=db_session, user=user, notification=notification)

    subscriptions_of_user = list(
        db_session.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id))
    )
    result = NotificationResult()
    if not subscriptions_of_user:
        logger.debug(f"No push subscriptions for {user}; nothing to send")
        return result

    payload = {**notification.to_payload(), "log_id": entry.id}
    logger.debug(f"Sending {notification} to {len(subscriptions_of_user)} subscription(s) of {user}")
    expired = []
    for subscription in subscriptions_of_user:
        push_result = push_service.send(subscription_info=subscription.to_subscription_info(), payload=payload)
        logger.debug(f"Push to {subscription}: {push_result}")
        if push_result.outcome is PushOutcome.DELIVERED:
            result.delivered += 1
        elif push_result.outcome is PushOutcome.EXPIRED:
            expired.append(subscription)
        else:
            result.failed += 1
            if result.error is None:
                result.error = push_result.detail

    if expired:
        for subscription in expired:
            db_session.delete(subscription)
        db_session.commit()
        result.pruned = len(expired)
        logger.info(f"Pruned {result.pruned} expired push subscription(s) for {user}")

    logger.info(f"Notified {user}: {result}")
    return result
