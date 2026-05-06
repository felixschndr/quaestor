from source.exceptions import UserNotFoundError
from source.models.user import User
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session


def list_users(session: Session) -> list[User]:
    return list(session.scalars(select(User)))


def create_user(session: Session, name: str) -> User:
    user = User(name=name)
    session.add(user)
    session.commit()
    return user


def get_user(session: Session, user_id: int) -> User:
    try:
        return session.scalars(select(User).where(User.id == user_id)).one()
    except NoResultFound:
        raise UserNotFoundError(f"User with the id {user_id} not found")


def update_user(session: Session, user_id: int, fields: dict) -> User:
    user = get_user(session, user_id)
    for key, value in fields.items():
        setattr(user, key, value)
    session.commit()
    return user


def delete_user(session: Session, user_id: int) -> None:
    user = get_user(session, user_id)
    session.delete(user)
    session.commit()
