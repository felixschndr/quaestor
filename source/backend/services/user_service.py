import os

from source.backend.exceptions import UserNameAlreadyExistsError, UserNotFoundError
from source.backend.logging_utils import get_logger
from source.backend.models.theme import Theme
from source.backend.models.user import User
from source.backend.services import i18n_service
from source.backend.services.password_service import hash_password
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

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

    if db_session.scalar(select(User.id).where(User.user_name == normalized_user_name)) is not None:
        raise UserNameAlreadyExistsError(f"User name {normalized_user_name!r} is already taken")

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
    logger.info(f"Created user {user}")
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


def update_user(db_session: Session, user_id: int, fields: dict) -> User:
    user = get_user_by_id(db_session=db_session, user_id=user_id)
    new_user_name = fields.get("user_name")
    if new_user_name is not None and new_user_name != user.user_name:
        conflicting_id = db_session.scalar(select(User.id).where(User.user_name == new_user_name))
        if conflicting_id is not None:
            raise UserNameAlreadyExistsError(f"User name {new_user_name!r} is already taken")
    user_before_change = str(user)
    for key, value in fields.items():
        setattr(user, key, value)
    try:
        db_session.commit()
    except IntegrityError:
        db_session.rollback()
        raise UserNameAlreadyExistsError(f"User name {new_user_name!r} is already taken")
    logger.info(f"Updated user {user_before_change} --> {user}")
    return user


def delete_user(db_session: Session, user_id: int) -> None:
    user = get_user_by_id(db_session=db_session, user_id=user_id)
    db_session.delete(user)
    db_session.commit()
    logger.info(f"Deleted user {user}")
