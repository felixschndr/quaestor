from fastapi import Depends
from pydantic import BaseModel
from source.backend.api.create_router import create_router
from source.backend.db import get_session
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.push_subscription import PushSubscription
from source.backend.models.user import User
from source.backend.services import push_service, session_service
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
