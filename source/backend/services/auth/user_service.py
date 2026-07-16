import os

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from source.backend.exceptions import UserNameAlreadyExistsError, UserNotFoundError
from source.backend.helpers import apply_fields
from source.backend.logging_utils import get_logger
from source.backend.models.auth.theme import Theme
from source.backend.models.auth.user import User
from source.backend.models.base import snapshot_columns
from source.backend.services.auth.password_service import hash_password
from source.backend.services.core import i18n_service

logger = get_logger(__name__)

ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME = "ALLOW_NEW_USER_REGISTRATION"


def new_user_registration_allowed() -> bool:
    return os.environ.get(key=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, default="true").lower() == "true"


def list_users(db_session: Session) -> list[User]:
    users = list(db_session.scalars(select(User)))
    logger.debug(f"Found {len(users)} user(s)")
    return users


def create_user(
    db_session: Session,
    user_name: str,
    display_name: str,
    password: str,
    theme: Theme = Theme.SYSTEM,
) -> User:
    normalized_user_name = user_name.strip().lower()
    user = User(
        user_name=normalized_user_name,
        display_name=display_name,
        password_hash=hash_password(password),
        theme=theme,
        language=i18n_service.get_default_language(),
    )
    db_session.add(user)
    try:
        db_session.commit()
    except IntegrityError:
        db_session.rollback()
        raise UserNameAlreadyExistsError(f"User name {normalized_user_name!r} is already taken")
    logger.info(f"Created {user}")
    return user


def _get_user(db_session: Session, condition: ColumnElement[bool], identifier_description: str) -> User:
    try:
        user = db_session.scalars(select(User).where(condition)).one()
    except NoResultFound:
        error_message = f"User with the {identifier_description} not found"
        logger.warning(error_message)
        raise UserNotFoundError(error_message)
    logger.debug(f"Loaded user with the {identifier_description}")
    return user


def get_user_by_id(db_session: Session, user_id: int) -> User:
    return _get_user(db_session=db_session, condition=User.id == user_id, identifier_description=f"ID {user_id}")


def get_user_by_user_name(db_session: Session, user_name: str) -> User:
    normalized_user_name = user_name.strip().lower()
    return _get_user(
        db_session=db_session,
        condition=User.user_name == normalized_user_name,
        identifier_description=f'user_name "{normalized_user_name}"',
    )


def update_user(db_session: Session, user: User, fields: dict) -> User:
    logger.debug(f"Updating {user} with fields {sorted(fields)}")
    new_user_name = fields.get("user_name")
    state_before_update = snapshot_columns(user)
    apply_fields(entity=user, fields=fields)
    try:
        db_session.commit()
    except IntegrityError:
        db_session.rollback()
        raise UserNameAlreadyExistsError(f"User name {new_user_name!r} is already taken")
    logger.update(state_before_update=state_before_update, entity_after_update=user)
    return user


def delete_user(db_session: Session, user: User) -> None:
    logger.debug(f"Deleting {user}")
    db_session.delete(user)
    db_session.commit()
    logger.info(f"Deleted user {user}")
