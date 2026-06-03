import hashlib
import secrets
from datetime import datetime

from fastapi import Request
from source.backend.exceptions import ApiKeyNotFoundError
from source.backend.logging_utils import get_logger
from source.backend.models.api_key import ApiKey
from source.backend.models.user import User
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

TOKEN_PREFIX = "qk_"  # nosec B105
_PREFIX_DISPLAY_LENGTH = len(TOKEN_PREFIX) + 6
_AUTHORIZATION_HEADER = "Authorization"
_BEARER_SCHEME = "Bearer "


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def extract_bearer_token(request: Request) -> str | None:
    header = request.headers.get(_AUTHORIZATION_HEADER)
    if not header or not header.startswith(_BEARER_SCHEME):
        return None
    return header.removeprefix(_BEARER_SCHEME).strip() or None


def request_carries_api_key(request: Request) -> bool:
    token = extract_bearer_token(request)
    return token is not None and token.startswith(TOKEN_PREFIX)


def create_api_key(db_session: Session, user: User, name: str) -> tuple[str, ApiKey]:
    raw_token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    api_key = ApiKey(
        user_id=user.id,
        name=name,
        token_hash=_hash_token(raw_token),
        prefix=raw_token[:_PREFIX_DISPLAY_LENGTH],
        created_at=datetime.now(),
        last_used_at=None,
    )
    db_session.add(api_key)
    db_session.commit()
    logger.info(f"Created API key {api_key}")
    return raw_token, api_key


def list_api_keys(db_session: Session, user_id: int) -> list[ApiKey]:
    api_keys = list(db_session.scalars(select(ApiKey).where(ApiKey.user_id == user_id)))
    logger.debug(f"Found {len(api_keys)} API key(s) for user {user_id}")
    return api_keys


def delete_api_key(db_session: Session, user_id: int, api_key_id: int) -> None:
    api_key = db_session.get(entity=ApiKey, ident=api_key_id)
    if api_key is None or api_key.user_id != user_id:
        logger.warning(f"User {user_id} attempted to delete API key {api_key_id} which does not belong to them")
        raise ApiKeyNotFoundError(f"API key with the ID {api_key_id} not found")
    db_session.delete(api_key)
    db_session.commit()
    logger.info(f"Deleted API key {api_key_id} for user {user_id}")


def authenticate(db_session: Session, raw_token: str) -> User | None:
    api_key = db_session.scalar(select(ApiKey).where(ApiKey.token_hash == _hash_token(raw_token)))
    if api_key is None:
        logger.debug("Presented API key does not match any known key")
        return None
    api_key.last_used_at = datetime.now()
    db_session.commit()
    logger.debug(f"Authenticated request via API key {api_key.id} for user {api_key.user_id}")
    return api_key.user
