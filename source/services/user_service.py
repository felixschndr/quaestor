import logging

from source.exceptions import PermissionDeniedError, UserNotFoundError
from source.models.user import User
from source.services.password_service import hash_password
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def list_users(session: Session) -> list[User]:
    users = list(session.scalars(select(User)))
    logger.debug(f"Found {len(users)} user(s)")
    return users


def create_user(session: Session, name: str, password: str) -> User:
    is_first_user = session.scalar(select(User.id).limit(1)) is None
    user = User(name=name, password_hash=hash_password(password), admin=is_first_user)
    session.add(user)
    session.commit()
    logger.info(f"Created user with the ID {user.id} as {'admin' if user.admin else 'normal user'}")
    return user


def get_user(session: Session, user_id: int) -> User:
    try:
        user = session.scalars(select(User).where(User.id == user_id)).one()
    except NoResultFound:
        error_message = f"User with the ID {user_id} not found"
        logger.warning(error_message)
        raise UserNotFoundError(error_message)
    logger.debug(f"Loaded user with the ID {user_id}")
    return user


def update_user(session: Session, user_id: int, fields: dict) -> User:
    user = get_user(session, user_id)
    for key, value in fields.items():
        setattr(user, key, value)
    session.commit()
    logger.info(f"Updated user {user_id}, fields: {sorted(fields)}")
    return user


def elevate_user(session: Session, acting_admin_id: int, target_user_id: int) -> User:
    acting_admin = get_user(session, acting_admin_id)
    if not acting_admin.admin:
        error_message = f"User with the ID {acting_admin_id} is not an admin and cannot elevate other users"
        logger.warning(error_message)
        raise PermissionDeniedError(error_message)

    target_user = get_user(session, target_user_id)
    target_user.admin = True
    session.commit()
    logger.info(f"User with the ID {target_user_id} elevated to admin by admin {acting_admin_id}")
    return target_user


def delete_user(session: Session, user_id: int) -> None:
    user = get_user(session, user_id)
    session.delete(user)
    session.commit()
    logger.info(f"Deleted user {user_id}")
