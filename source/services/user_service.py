from source.exceptions import UserNotFoundError
from source.models.user import User
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session


def list_users(session: Session) -> list[User]:
    return list(session.scalars(select(User)))


def get_user(session: Session, user_id: int) -> User:
    try:
        return session.scalars(select(User).where(User.id == user_id)).one()
    except NoResultFound:
        raise UserNotFoundError(f"User with the id {user_id} not found")


def create_user(session: Session, name: str) -> User:
    user = User(name=name)
    session.add(user)
    session.commit()
    return user


def delete_user(session: Session, user_id: int) -> None:
    user = session.get(User, user_id)
    if user is None:
        raise UserNotFoundError(f"User with the id {user_id} not found")
    session.delete(user)
    session.commit()
