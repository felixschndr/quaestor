import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta

from fastapi import Response
from source.models.session import UserSession
from source.models.user import User
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SESSION_DURATION = timedelta(days=14)
COOKIE_NAME = "session"


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _cookie_is_secure() -> bool:
    return os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"


def create_session(db_session: Session, user: User) -> str:
    raw_token = secrets.token_urlsafe(32)
    now = datetime.now()
    db_session.add(
        UserSession(
            user_id=user.id,
            token_hash=_hash_token(raw_token),
            created_at=now,
            expires_at=now + SESSION_DURATION,
        )
    )
    db_session.commit()
    logger.info(f"Created session for user with the ID {user.id}")
    return raw_token


def _get_session_by_raw_token(db_session: Session, raw_token: str) -> UserSession | None:
    user_session = db_session.scalar(select(UserSession).where(UserSession.token_hash == _hash_token(raw_token)))
    if user_session is None:
        return None
    if user_session.expires_at < datetime.now():
        logger.debug(f"Session {user_session.id} expired")
        return None
    return user_session


def renew_session(db_session: Session, raw_token: str) -> UserSession | None:
    user_session = _get_session_by_raw_token(db_session, raw_token)
    if user_session is None:
        return None
    user_session.expires_at = datetime.now() + SESSION_DURATION
    db_session.commit()
    return user_session


def get_user_by_raw_token(db_session: Session, raw_token: str) -> User | None:
    user_session = _get_session_by_raw_token(db_session, raw_token)
    return user_session.user if user_session else None


def delete_session(db_session: Session, raw_token: str) -> None:
    user_session = _get_session_by_raw_token(db_session, raw_token)
    if user_session is not None:
        logger.info(f"Deleting session for user with the ID {user_session.user_id}")
        db_session.delete(user_session)
        db_session.commit()


def set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=int(SESSION_DURATION.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=_cookie_is_secure(),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
