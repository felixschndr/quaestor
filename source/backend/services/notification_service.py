from dataclasses import dataclass, field

from source.backend.logging_utils import get_logger
from source.backend.models.push_subscription import PushSubscription
from source.backend.models.user import User
from source.backend.services import push_service
from source.backend.services.push_service import PushOutcome
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


@dataclass(frozen=True)
class Notification:
    title: str
    body: str
    url: str | None = None
    tag: str | None = None

    def to_payload(self) -> dict:
        payload: dict = {"title": self.title, "body": self.body}
        if self.url is not None:
            payload["url"] = self.url
        if self.tag is not None:
            payload["tag"] = self.tag
        return payload


@dataclass
class NotificationResult:
    delivered: int = 0
    pruned: int = 0
    failed: int = 0
    error: str | None = field(default=None)

    @property
    def attempted(self) -> int:
        return self.delivered + self.pruned + self.failed


def notify_user(db_session: Session, user: User, notification: Notification) -> NotificationResult:
    subscriptions_of_user = list(
        db_session.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id))
    )
    result = NotificationResult()
    if not subscriptions_of_user:
        logger.debug(f"No push subscriptions for {user}; nothing to send")
        return result

    payload = notification.to_payload()
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
