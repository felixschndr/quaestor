from fastapi import Depends
from source.backend.api.create_router import create_router
from source.backend.api.schemas.user import UserRead, UserUpdate
from source.backend.db import get_session
from source.backend.exceptions import InvalidCredentialsError, UserNotFoundError
from source.backend.models.user import User
from source.backend.services import credential_service, session_service, user_service
from source.backend.services.password_service import hash_password, verify_password
from sqlalchemy.orm import Session

router = create_router()


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> User:
    _require_self(user_id=user_id, current_user=current_user)
    fields = payload.model_dump(exclude_unset=True)
    current_password = fields.pop("current_password", None)
    new_password = fields.pop("new_password", None)
    if new_password is not None:
        if not verify_password(password_hash=current_user.password_hash, password_to_verify=current_password):
            raise InvalidCredentialsError("Current password is incorrect")
        fields["password_hash"] = hash_password(new_password)
    return user_service.update_user(db_session=db_session, user_id=current_user.id, fields=fields)


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
