from fastapi import Depends
from source.backend.api.create_router import create_router
from source.backend.api.schemas.user import UserRead, UserUpdate
from source.backend.db import get_session
from source.backend.exceptions import UserNotFoundError
from source.backend.models.user import User
from source.backend.services import credential_service, session_service, user_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("", response_model=list[UserRead])
def list_users(current_user: User = Depends(session_service.get_current_user_from_request)) -> list[User]:
    return [current_user]


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, current_user: User = Depends(session_service.get_current_user_from_request)) -> User:
    _require_self(user_id=user_id, current_user=current_user)
    return current_user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> User:
    _require_self(user_id=user_id, current_user=current_user)
    return user_service.update_user(
        db_session=db_session, user_id=current_user.id, fields=payload.model_dump(exclude_unset=True)
    )


@router.patch("/{user_id}/elevate", response_model=UserRead)
def elevate_user(
    user_id: int,
    current_admin: User = Depends(session_service.get_current_user_from_request_if_is_admin),
    db_session: Session = Depends(get_session),
) -> User:
    return user_service.elevate_user(db_session, acting_admin=current_admin, target_user_id=user_id)


@router.post("/sync", status_code=204)
def sync_credentials(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    for credential in credential_service.list_credentials(db_session, user_id=current_user.id):
        if credential.requires_two_factor_authentication:
            continue  # FIXME: Add support for 2FA credentials
        credential_service.sync_credential_object(db_session=db_session, credential=credential)
    db_session.commit()


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    _require_self(user_id=user_id, current_user=current_user)
    user_service.delete_user(db_session=db_session, user_id=current_user.id)


def _require_self(user_id: int, current_user: User) -> None:
    if user_id != current_user.id:
        raise UserNotFoundError(f"User with the ID {user_id} not found")
