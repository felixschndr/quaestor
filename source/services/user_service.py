import logging

from source.exceptions import UserNotFoundError
from source.models.user import User
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def list_users(session: Session) -> list[User]:
    users = list(session.scalars(select(User)))
    logger.debug(f"Found {len(users)} user(s)")
    return users


def create_user(session: Session, name: str) -> User:
    user = User(name=name)
    session.add(user)
    session.commit()
    logger.info(f"Created user with the ID {user.id}")
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


def delete_user(session: Session, user_id: int) -> None:
    user = get_user(session, user_id)
    session.delete(user)
    session.commit()
    logger.info(f"Deleted user {user_id}")
