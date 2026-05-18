from fastapi import Depends
from source.api._create_router import create_router
from source.api.schemas.user import UserCreate, UserElevate, UserRead, UserUpdate
from source.db import get_session
from source.models.user import User
from source.services import credential_service, user_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("", response_model=list[UserRead])
def list_users(session: Session = Depends(get_session)) -> list[User]:
    return user_service.list_users(session)


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, session: Session = Depends(get_session)) -> User:
    return user_service.get_user_by_id(session, user_id)


@router.post("", response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, session: Session = Depends(get_session)) -> User:
    return user_service.create_user(session, payload.name, payload.password)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, session: Session = Depends(get_session)) -> User:
    return user_service.update_user(session, user_id, payload.model_dump(exclude_unset=True))


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, session: Session = Depends(get_session)) -> None:
    user_service.delete_user(session, user_id)


@router.patch("/{user_id}/elevate", response_model=UserRead)
def elevate_user(user_id: int, payload: UserElevate, session: Session = Depends(get_session)) -> User:
    return user_service.elevate_user(session, acting_admin_id=payload.acting_admin_id, target_user_id=user_id)


@router.post("/{user_id}/sync", status_code=204)
def sync_accounts(user_id: int, session: Session = Depends(get_session)) -> None:
    user = user_service.get_user_by_id(session, user_id)
    for credential in credential_service.list_credentials(session, user_id=user.id):
        if credential.requires_two_factor_authentication:
            continue  # FIXME: Add support for 2FA credentials
        credential_service.sync_credential_object(session, credential)
    session.commit()
