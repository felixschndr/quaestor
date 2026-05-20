import os

from source.backend.exceptions import UserNotFoundError
from source.backend.logging_utils import get_logger
from source.backend.models.user import User
from source.backend.services.password_service import hash_password
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound
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


def create_user(db_session: Session, user_name: str, display_name: str, password: str) -> User:
    is_first_user = db_session.scalar(select(User.id).limit(1)) is None
    user = User(
        user_name=user_name, display_name=display_name, password_hash=hash_password(password), admin=is_first_user
    )
    db_session.add(user)
    db_session.commit()
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
    return _get_user(
        db_session=db_session, condition=User.user_name == user_name, identifier_description=f'user_name "{user_name}"'
    )


def update_user(db_session: Session, user_id: int, fields: dict) -> User:
    user = get_user_by_id(db_session=db_session, user_id=user_id)
    user_before_change = str(user)
    for key, value in fields.items():
        setattr(user, key, value)
    db_session.commit()
    logger.info(f"Updated user {user_before_change} --> {user}")
    return user


def elevate_user(db_session: Session, acting_admin: User, target_user_id: int) -> User:
    target_user = get_user_by_id(db_session=db_session, user_id=target_user_id)
    target_user.admin = True
    db_session.commit()
    logger.info(f"Elevated {target_user} to admin (acting admin: {acting_admin})")
    return target_user


def delete_user(db_session: Session, user_id: int) -> None:
    user = get_user_by_id(db_session=db_session, user_id=user_id)
    db_session.delete(user)
    db_session.commit()
    logger.info(f"Deleted user {user}")
