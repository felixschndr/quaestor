import hashlib
import os
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, Request, Response
from source.backend.db import get_session
from source.backend.exceptions import InvalidCredentialsError, PermissionDeniedError
from source.backend.logging_utils import get_logger
from source.backend.models.session import UserSession
from source.backend.models.user import User
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

SESSION_DURATION = timedelta(days=14)
COOKIE_NAME = "session"


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _cookie_is_secure() -> bool:
    return os.environ.get(key="SESSION_COOKIE_SECURE", default="false").lower() == "true"


def create_session(db_session: Session, user: User, remember_me: bool = False) -> str:
    raw_token = secrets.token_urlsafe(32)
    now = datetime.now()
    user_session = UserSession(
        user_id=user.id,
        token_hash=_hash_token(raw_token),
        created_at=now,
        expires_at=now + SESSION_DURATION,
        remember_me=remember_me,
    )
    db_session.add(user_session)
    db_session.commit()
    logger.info(f"Created session {user_session}")
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
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    if user_session is None:
        return None
    user_session.expires_at = datetime.now() + SESSION_DURATION
    db_session.commit()
    return user_session


def get_user_by_raw_token(db_session: Session, raw_token: str) -> User | None:
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    return user_session.user if user_session else None


def delete_session(db_session: Session, raw_token: str) -> None:
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    if user_session is not None:
        db_session.delete(user_session)
        db_session.commit()
        logger.info(f"Deleted session {user_session}")


def set_session_cookie(response: Response, raw_token: str, remember_me: bool = False) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=int(SESSION_DURATION.total_seconds()) if remember_me else None,
        httponly=True,
        samesite="strict",
        secure=_cookie_is_secure(),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def get_current_user_from_request(request: Request, db_session: Session = Depends(get_session)) -> User:
    raw_token = request.cookies.get(COOKIE_NAME)
    user = get_user_by_raw_token(db_session=db_session, raw_token=raw_token) if raw_token else None
    if user is None:
        raise InvalidCredentialsError("Authentication required")
    return user


def get_current_user_from_request_if_is_admin(user: User = Depends(get_current_user_from_request)) -> User:
    if not user.admin:
        raise PermissionDeniedError("Admin privileges required")
    return user
