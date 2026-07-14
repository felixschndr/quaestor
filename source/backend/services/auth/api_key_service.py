import secrets

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.exceptions import ApiKeyNotFoundError
from source.backend.helpers import hash_token, utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.auth.api_key import ApiKey
from source.backend.models.auth.user import User

logger = get_logger(__name__)

TOKEN_PREFIX = "qk_"  # nosec B105
_PREFIX_DISPLAY_LENGTH = len(TOKEN_PREFIX) + 6
_AUTHORIZATION_HEADER = "Authorization"
_BEARER_SCHEME = "Bearer "


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
        token_hash=hash_token(raw_token),
        prefix=raw_token[:_PREFIX_DISPLAY_LENGTH],
        created_at=utc_now(),
        last_used_at=None,
    )
    db_session.add(api_key)
    db_session.commit()
    logger.info(f"Created API key {api_key}")
    return raw_token, api_key


def list_api_keys(db_session: Session, user: User) -> list[ApiKey]:
    api_keys = list(db_session.scalars(select(ApiKey).where(ApiKey.user_id == user.id)))
    logger.debug(f"Found {len(api_keys)} API key(s) for {user}")
    return api_keys


def get_api_key_for_user(db_session: Session, api_key_id: int, user: User) -> ApiKey:
    api_key = db_session.get(entity=ApiKey, ident=api_key_id)
    if api_key is None or api_key.user_id != user.id:
        logger.warning(f"{user} attempted to access API key {api_key_id} which does not belong to them")
        raise ApiKeyNotFoundError(f"API key with the ID {api_key_id} not found")
    logger.debug(f"{user} accessed {api_key}")
    return api_key


def delete_api_key(db_session: Session, api_key: ApiKey) -> None:
    logger.debug(f"Deleting {api_key}")
    db_session.delete(api_key)
    db_session.commit()
    logger.info(f"Deleted {api_key}")


def authenticate(db_session: Session, raw_token: str) -> User | None:
    api_key = db_session.scalar(select(ApiKey).where(ApiKey.token_hash == hash_token(raw_token)))
    if api_key is None:
        logger.debug("Presented API key does not match any known key")
        return None
    api_key.last_used_at = utc_now()
    db_session.commit()
    logger.debug(f"Authenticated request via {api_key}")
    return api_key.user


def resolve_log_label(db_session: Session, request: Request) -> str | None:
    raw_token = extract_bearer_token(request)
    if raw_token is None:
        return None
    api_key = db_session.scalar(select(ApiKey).where(ApiKey.token_hash == hash_token(raw_token)))
    return api_key.log_label() if api_key is not None else None
