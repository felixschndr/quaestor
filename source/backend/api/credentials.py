from fastapi import Depends, Response, status
from source.backend.api.create_router import create_router
from source.backend.api.schemas.credential import (
    CredentialCreate,
    CredentialRead,
    CredentialUpdate,
    SyncResponse,
    TwoFactorConfirm,
)
from source.backend.db import get_session
from source.backend.models.credential import Credential
from source.backend.models.user import User
from source.backend.services import credential_service, session_service
from source.backend.services.credential_service import SyncStatus
from sqlalchemy.orm import Session

router = create_router()


@router.get("/list_all_possible")
def list_all_possible(_: User = Depends(session_service.get_current_user_from_request)) -> list[dict]:
    return credential_service.list_all_possible()


@router.post("", response_model=CredentialRead, status_code=201)
def create_credential(
    payload: CredentialCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.create_credential(
        db_session,
        user_id=current_user.id,
        bank=payload.bank,
        credentials=payload.credentials,
    )


@router.get("/{credential_id}", response_model=CredentialRead)
def get_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user_id=current_user.id
    )


# TODO: List all my credentials


@router.patch("/{credential_id}", response_model=CredentialRead)
def update_credential(
    credential_id: int,
    payload: CredentialUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user_id=current_user.id
    )
    return credential_service.update_credential(
        db_session=db_session, credential_id=credential_id, fields=payload.model_dump(exclude_unset=True)
    )


@router.delete("/{credential_id}", status_code=204)
def delete_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user_id=current_user.id
    )
    credential_service.delete_credential(db_session=db_session, credential_id=credential_id)


@router.post("/{credential_id}/sync", response_model=SyncResponse)
def sync_credential(
    credential_id: int,
    response: Response,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> SyncResponse:
    credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user_id=current_user.id
    )
    result = credential_service.sync_credential(db_session=db_session, credential_id=credential_id)
    if result.status == SyncStatus.TWO_FACTOR_REQUIRED:
        response.status_code = status.HTTP_202_ACCEPTED
    return SyncResponse(status=result.status, challenge_token=result.challenge_token, expires_at=result.expires_at)


@router.post("/{credential_id}/sync/2fa", response_model=SyncResponse)
def sync_complete_two_factor(
    credential_id: int,
    payload: TwoFactorConfirm,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> SyncResponse:
    credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user_id=current_user.id
    )
    result = credential_service.confirm_two_factor(
        db_session=db_session, credential_id=credential_id, challenge_token=payload.challenge_token, code=payload.code
    )
    return SyncResponse(status=result.status, challenge_token=result.challenge_token, expires_at=result.expires_at)
