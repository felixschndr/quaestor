from fastapi import APIRouter, Depends
from source.api.schemas import UserCreate, UserRead, UserUpdate
from source.db import get_session
from source.models import User
from source.services import account_service, user_service
from sqlalchemy.orm import Session

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead])
def list_users(session: Session = Depends(get_session)) -> list[User]:
    return user_service.list_users(session)


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, session: Session = Depends(get_session)) -> User:
    return user_service.get_user(session, user_id)


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, session: Session = Depends(get_session)) -> User:
    return user_service.create_user(session, payload.name)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, session: Session = Depends(get_session)) -> User:
    return user_service.update_user(session, user_id, payload.model_dump(exclude_unset=True))


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, session: Session = Depends(get_session)) -> None:
    user_service.delete_user(session, user_id)


@router.post("/{user_id}/accounts/sync", status_code=204)
def sync_accounts(user_id: int, session: Session = Depends(get_session)) -> None:
    user = user_service.get_user(session, user_id)
    accounts = account_service.list_accounts(session, user_id=user.id)
    for account in accounts:
        account.sync()
    session.commit()
