from fastapi import Depends, Request
from sqlalchemy.orm import Session

from source.backend.api.create_router import create_router
from source.backend.api.schemas.credential import SyncJobRead
from source.backend.api.schemas.session import SessionRead
from source.backend.api.schemas.two_factor import (
    BackupCodesRead,
    TwoFactorDisableRequest,
    TwoFactorEnableRequest,
    TwoFactorSetupRead,
)
from source.backend.api.schemas.user import UserRead, UserUpdate
from source.backend.db import get_session
from source.backend.exceptions import (
    InvalidCredentialsError,
    UserNotFoundError,
    ValidationError,
)
from source.backend.models.user import User
from source.backend.services import (
    credential_service,
    session_service,
    sync_jobs,
    two_factor_service,
    user_service,
)
from source.backend.services.password_service import hash_password, verify_password

router = create_router()


@router.get("/{user_id}/sessions", response_model=list[SessionRead])
def list_user_sessions(
    user_id: int,
    request: Request,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> list[SessionRead]:
    _require_self(user_id=user_id, current_user=current_user)
    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    return [
        SessionRead(
            id=user_session.id,
            created_at=user_session.created_at,
            last_used_at=user_session.last_used_at,
            ip=user_session.ip,
            user_agent=user_session.user_agent,
            is_current=session_service.is_current_session(user_session=user_session, raw_token=raw_token),
        )
        for user_session in session_service.list_sessions_for_user(db_session=db_session, user=current_user)
    ]


@router.delete("/{user_id}/sessions", status_code=204)
def revoke_all_other_user_sessions(
    user_id: int,
    request: Request,
    exclude_current: bool = False,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> None:
    _require_self(user_id=user_id, current_user=current_user)
    if not exclude_current:
        raise ValidationError(
            "This endpoint only supports exclude_current=true; "
            "use DELETE /api/users/{id}/sessions/{session_id} or POST /api/auth/logout for other cases"
        )
    session_service.revoke_all_other_sessions_for_user(
        db_session=db_session,
        user=current_user,
        current_raw_token=request.cookies.get(session_service.COOKIE_NAME),
    )


@router.delete("/{user_id}/sessions/{session_id}", status_code=204)
def revoke_user_session(
    user_id: int,
    session_id: int,
    request: Request,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> None:
    _require_self(user_id=user_id, current_user=current_user)
    session_service.revoke_user_session(
        db_session=db_session,
        user=current_user,
        session_id=session_id,
        current_raw_token=request.cookies.get(session_service.COOKIE_NAME),
    )


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    current_user: User = Depends(session_service.get_current_user_from_session),
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
    user = user_service.update_user(db_session=db_session, user=current_user, fields=fields)
    if new_password is not None:
        session_service.revoke_all_other_sessions_for_user(
            db_session=db_session,
            user=current_user,
            current_raw_token=request.cookies.get(session_service.COOKIE_NAME),
        )
    return user


@router.post("/{user_id}/2fa/setup", response_model=TwoFactorSetupRead)
def setup_two_factor(
    user_id: int,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> TwoFactorSetupRead:
    _require_self(user_id=user_id, current_user=current_user)
    secret, otpauth_uri, qr_code = two_factor_service.start_setup(db_session=db_session, user=current_user)
    return TwoFactorSetupRead(secret=secret, otpauth_uri=otpauth_uri, qr_code=qr_code)


@router.post("/{user_id}/2fa/enable", response_model=BackupCodesRead)
def enable_two_factor(
    user_id: int,
    payload: TwoFactorEnableRequest,
    request: Request,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> BackupCodesRead:
    _require_self(user_id=user_id, current_user=current_user)
    backup_codes = two_factor_service.enable(db_session=db_session, user=current_user, code=payload.code)
    session_service.revoke_all_other_sessions_for_user(
        db_session=db_session,
        user=current_user,
        current_raw_token=request.cookies.get(session_service.COOKIE_NAME),
    )
    return BackupCodesRead(backup_codes=backup_codes)


@router.post("/{user_id}/2fa/disable", status_code=204)
def disable_two_factor(
    user_id: int,
    payload: TwoFactorDisableRequest,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> None:
    _require_self(user_id=user_id, current_user=current_user)
    two_factor_service.disable(db_session=db_session, user=current_user, code=payload.code)


@router.post("/{user_id}/2fa/backup-codes", response_model=BackupCodesRead)
def regenerate_two_factor_backup_codes(
    user_id: int,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> BackupCodesRead:
    _require_self(user_id=user_id, current_user=current_user)
    backup_codes = two_factor_service.regenerate_backup_codes(db_session=db_session, user=current_user)
    return BackupCodesRead(backup_codes=backup_codes)


@router.post("/sync", response_model=list[SyncJobRead], status_code=202)
async def sync_credentials(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[SyncJobRead]:
    credentials = credential_service.list_credentials(db_session, user=current_user)
    jobs = []
    for credential in credentials:
        if not credential.sync_enabled:
            continue
        job = await sync_jobs.start_sync(credential_id=credential.id)
        jobs.append(SyncJobRead.model_validate(job))
    return jobs


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> None:
    _require_self(user_id=user_id, current_user=current_user)
    user_service.delete_user(db_session=db_session, user=current_user)


def _require_self(user_id: int, current_user: User) -> None:
    if user_id != current_user.id:
        raise UserNotFoundError(f"User with the ID {user_id} not found")
