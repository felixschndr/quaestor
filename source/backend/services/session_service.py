import hashlib
import os
import secrets
from datetime import timedelta

from fastapi import Depends, Request, Response
from source.backend.db import get_session
from source.backend.exceptions import (
    CannotRevokeCurrentSessionError,
    InvalidCredentialsError,
    SessionNotFoundError,
)
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.session import UserSession
from source.backend.models.user import User
from source.backend.services import api_key_service
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

SESSION_DURATION = timedelta(days=14)
COOKIE_NAME = "session"


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def cookie_is_secure() -> bool:
    return os.environ.get(key="SESSION_COOKIE_SECURE", default="false").lower() == "true"


def create_session(
    db_session: Session,
    user: User,
    remember_me: bool = False,
    ip: str | None = None,
    user_agent: str | None = None,
) -> str:
    raw_token = secrets.token_urlsafe(32)
    now = utc_now()
    user_session = UserSession(
        user_id=user.id,
        token_hash=_hash_token(raw_token),
        created_at=now,
        expires_at=now + SESSION_DURATION,
        last_used_at=now,
        ip=ip,
        user_agent=user_agent,
        remember_me=remember_me,
    )
    db_session.add(user_session)
    db_session.commit()
    logger.info(f"Created session {user_session}")
    return raw_token


def _get_session_by_raw_token(db_session: Session, raw_token: str) -> UserSession | None:
    user_session = db_session.scalar(select(UserSession).where(UserSession.token_hash == _hash_token(raw_token)))
    if user_session is None:
        logger.debug("Presented session token does not match any known session")
        return None
    if user_session.expires_at < utc_now():
        logger.debug(f"Session {user_session} expired at {user_session.expires_at:%Y-%m-%d %H:%M:%S}")
        return None
    logger.debug(f"Matched session {user_session}")
    return user_session


def renew_session(db_session: Session, raw_token: str) -> UserSession | None:
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    if user_session is None:
        return None
    now = utc_now()
    new_expiry = now + SESSION_DURATION
    logger.debug(f"Renewing session {user_session} expiry: {user_session.expires_at} --> {new_expiry}")
    user_session.expires_at = new_expiry
    user_session.last_used_at = now
    db_session.commit()
    return user_session


def list_sessions_for_user(db_session: Session, user: User) -> list[UserSession]:
    sessions = list(db_session.scalars(select(UserSession).where(UserSession.user_id == user.id)))
    logger.debug(f"Found {len(sessions)} session(s) for {user}")
    return sessions


def is_current_session(user_session: UserSession, raw_token: str | None) -> bool:
    return raw_token is not None and user_session.token_hash == _hash_token(raw_token)


def revoke_all_other_sessions_for_user(db_session: Session, user: User, current_raw_token: str | None) -> int:
    sessions = list_sessions_for_user(db_session=db_session, user=user)
    revoked = 0
    for user_session in sessions:
        if is_current_session(user_session=user_session, raw_token=current_raw_token):
            logger.debug(f"Keeping current {user_session} while revoking the others")
            continue
        logger.debug(f"Revoking {user_session}")
        db_session.delete(user_session)
        revoked += 1
    if revoked:
        db_session.commit()
    logger.info(f"Revoked {revoked} other session(s) for {user}")
    return revoked


def revoke_user_session(db_session: Session, user: User, session_id: int, current_raw_token: str | None) -> None:
    user_session = db_session.get(entity=UserSession, ident=session_id)
    not_found_error = SessionNotFoundError(f"Session with the ID {session_id} not found")
    if user_session is None or user_session.user_id != user.id:
        logger.warning(f"{user} attempted to revoke session {session_id} which does not belong to them")
        raise not_found_error
    if is_current_session(user_session=user_session, raw_token=current_raw_token):
        logger.debug(f"{user} attempted to revoke their current {user_session} via the revoke endpoint")
        raise CannotRevokeCurrentSessionError(
            "Cannot revoke the current session via this endpoint; use POST /api/auth/logout instead"
        )
    db_session.delete(user_session)
    db_session.commit()
    logger.info(f"Revoked {user_session}")


def get_user_by_raw_token(db_session: Session, raw_token: str) -> User | None:
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    return user_session.user if user_session else None


def delete_session(db_session: Session, raw_token: str) -> None:
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    if user_session is None:
        logger.warning("Asked to delete a session but no matching session was found")
        return
    db_session.delete(user_session)
    db_session.commit()
    logger.info(f"Deleted session {user_session}")


def set_session_cookie(response: Response, raw_token: str, remember_me: bool = False) -> None:
    max_age = int(SESSION_DURATION.total_seconds()) if remember_me else None
    logger.debug(
        f"Setting session cookie ({'persistent, max_age=' + str(max_age) + 's' if remember_me else 'session-only'}, "
        f"secure={cookie_is_secure()})"
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=cookie_is_secure(),
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    logger.debug("Clearing session cookie from response")
    response.delete_cookie(COOKIE_NAME, path="/")


def get_current_user_from_session(request: Request, db_session: Session = Depends(get_session)) -> User:
    raw_token = request.cookies.get(COOKIE_NAME)
    if not raw_token:
        logger.debug(f"[{request.method}] [{request.url.path}]: no session cookie, authentication failed")
        raise InvalidCredentialsError("Authentication required")
    user_session = _get_session_by_raw_token(db_session=db_session, raw_token=raw_token)
    if user_session is None:
        logger.debug(
            f"[{request.method}] [{request.url.path}]: session cookie did not resolve to a session, authentication failed"
        )
        raise InvalidCredentialsError("Authentication required")
    logger.debug(f"[{request.method}] [{request.url.path}]: authenticated {user_session.user} via {user_session}")
    return user_session.user


def _authenticate_via_api_key(request: Request, db_session: Session) -> User:
    raw_token = api_key_service.extract_bearer_token(request)
    user = api_key_service.authenticate(db_session=db_session, raw_token=raw_token)
    if user is None:
        logger.debug(f"[{request.method}] [{request.url.path}]: API key did not resolve to a user")
        raise InvalidCredentialsError("Authentication required")
    logger.debug(f"[{request.method}] [{request.url.path}]: authenticated {user} via API key")
    return user


def get_current_user_from_request(request: Request, db_session: Session = Depends(get_session)) -> User:
    if api_key_service.request_carries_api_key(request):
        return _authenticate_via_api_key(request=request, db_session=db_session)
    return get_current_user_from_session(request=request, db_session=db_session)
