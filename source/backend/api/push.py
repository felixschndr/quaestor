import asyncio

from fastapi import Depends
from pydantic import BaseModel
from source.backend.api.create_router import create_router
from source.backend.db import SessionLocal, get_session
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.push_subscription import PushSubscription
from source.backend.models.user import User
from source.backend.services import push_service, session_service
from source.backend.services.notification_service import (
    Notification,
    NotificationResult,
    notify_user,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

router = create_router()
logger = get_logger(__name__)


class PublicKeyRead(BaseModel):
    public_key: str


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscriptionCreate(BaseModel):
    endpoint: str
    keys: SubscriptionKeys


class TestResult(BaseModel):
    sent: int
    failed: int
    error: str | None = None


@router.get("/public-key", response_model=PublicKeyRead)
def get_public_key() -> PublicKeyRead:
    return PublicKeyRead(public_key=push_service.get_application_server_key())


@router.post("/subscribe", status_code=204)
def subscribe(
    payload: SubscriptionCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    existing = db_session.scalar(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    if existing is not None:
        existing.user_id = current_user.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
    else:
        db_session.add(
            PushSubscription(
                user_id=current_user.id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
                created_at=utc_now(),
            )
        )
    db_session.commit()
    logger.info(f"Stored push subscription for {current_user}")


def _notify_in_thread(user_id: int, notification: Notification) -> NotificationResult:
    # Runs in a worker thread with its own DB session (webpush blocks on HTTP).
    with SessionLocal() as db_session:
        user = db_session.get(entity=User, ident=user_id)
        if user is None:
            return NotificationResult()
        return notify_user(db_session=db_session, user=user, notification=notification)


@router.post("/test", response_model=TestResult)
async def send_test(
    current_user: User = Depends(session_service.get_current_user_from_request),
) -> TestResult:
    notification = Notification(title="Quaestor", body="🔔 Test notification — push works!")
    result = await asyncio.to_thread(_notify_in_thread, current_user.id, notification)  # noqa FKA100
    logger.info(f"Sent test push: {result.delivered} delivered for {current_user}")
    return TestResult(sent=result.delivered, failed=result.pruned + result.failed, error=result.error)
