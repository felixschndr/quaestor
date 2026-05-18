from fastapi import Depends, Response, status
from source.api._create_router import create_router
from source.api.schemas.credential import (
    CredentialCreate,
    CredentialRead,
    CredentialUpdate,
    SyncResponse,
    TwoFactorConfirm,
)
from source.db import get_session
from source.models.credential import Credential
from source.services import credential_service
from source.services.credential_service import SyncStatus
from sqlalchemy.orm import Session

router = create_router()


@router.get("/list_all_possible")
def list_all_possible() -> list[dict]:
    return credential_service.list_all_possible()


@router.get("/{credential_id}", response_model=CredentialRead)
def get_credential(credential_id: int, session: Session = Depends(get_session)) -> Credential:
    return credential_service.get_credential(session, credential_id=credential_id)


@router.post("", response_model=CredentialRead, status_code=201)
def create_credential(payload: CredentialCreate, session: Session = Depends(get_session)) -> Credential:
    return credential_service.create_credential(
        session,
        user_id=payload.user_id,
        bank=payload.bank,
        username=payload.username,
        password=payload.password,
        extra=payload.model_extra or {},
    )


@router.patch("/{credential_id}", response_model=CredentialRead)
def update_credential(
    credential_id: int, payload: CredentialUpdate, session: Session = Depends(get_session)
) -> Credential:
    return credential_service.update_credential(session, credential_id, payload.model_dump(exclude_unset=True))


@router.delete("/{credential_id}", status_code=204)
def delete_credential(credential_id: int, session: Session = Depends(get_session)) -> None:
    credential_service.delete_credential(session, credential_id)


@router.post("/{credential_id}/sync", response_model=SyncResponse)
def sync_credential(credential_id: int, response: Response, session: Session = Depends(get_session)) -> SyncResponse:
    result = credential_service.sync_credential(session, credential_id)
    if result.status == SyncStatus.TWO_FACTOR_REQUIRED:
        response.status_code = status.HTTP_202_ACCEPTED
    return SyncResponse(status=result.status, challenge_token=result.challenge_token, expires_at=result.expires_at)


@router.post("/{credential_id}/sync/2fa", response_model=SyncResponse)
def sync_complete_two_factor(
    credential_id: int, payload: TwoFactorConfirm, session: Session = Depends(get_session)
) -> SyncResponse:
    result = credential_service.confirm_two_factor(session, credential_id, payload.challenge_token, payload.code)
    return SyncResponse(status=result.status, challenge_token=result.challenge_token, expires_at=result.expires_at)
