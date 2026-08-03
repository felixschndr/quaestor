from fastapi import Depends
from sqlalchemy.orm import Session

from source.backend.api.core.create_router import create_router
from source.backend.api.schemas.banking.credential import (
    CredentialCreate,
    CredentialRead,
    CredentialUpdate,
    SyncJobRead,
    TwoFactorCode,
)
from source.backend.db import get_session
from source.backend.exceptions import (
    InvalidTwoFactorError,
    NotFoundError,
)
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.services.auth import session_service
from source.backend.services.banking import bank_catalog, credential_service, sync_jobs

router = create_router()


@router.get("/supported_banks")
def list_supported_banks(_: User = Depends(session_service.get_current_user_from_request)) -> list[dict]:
    return bank_catalog.get_catalog()


@router.post("", response_model=CredentialRead, status_code=201)
def create_credential(
    payload: CredentialCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.create_credential(
        db_session,
        user=current_user,
        bank=payload.bank,
        credentials=payload.credentials,
    )


@router.get("", response_model=list[CredentialRead])
def list_credentials(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[Credential]:
    return credential_service.list_credentials(db_session=db_session, user=current_user)


@router.get("/sync", response_model=list[SyncJobRead])
def list_sync_jobs(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[SyncJobRead]:
    credential_ids = {c.id for c in credential_service.list_credentials(db_session=db_session, user=current_user)}
    jobs = sync_jobs.get_jobs_for_credentials(credential_ids)
    return [SyncJobRead.model_validate(job) for job in jobs]


def owned_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user=current_user
    )


@router.get("/{credential_id}", response_model=CredentialRead)
def get_credential(credential: Credential = Depends(owned_credential)) -> Credential:
    return credential


@router.patch("/{credential_id}", response_model=CredentialRead)
def update_credential(
    payload: CredentialUpdate,
    credential: Credential = Depends(owned_credential),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.update_credential(
        db_session=db_session, credential=credential, fields=payload.model_dump(exclude_unset=True)
    )


@router.delete("/{credential_id}", status_code=204)
def delete_credential(
    credential: Credential = Depends(owned_credential),
    db_session: Session = Depends(get_session),
) -> None:
    credential_service.delete_credential(db_session=db_session, credential=credential)


@router.post("/{credential_id}/sync", response_model=SyncJobRead, status_code=202)
async def start_sync(credential: Credential = Depends(owned_credential)) -> SyncJobRead:
    job = await sync_jobs.start_sync(credential_id=credential.id)
    return SyncJobRead.model_validate(job)


@router.get("/{credential_id}/sync/{job_id}", response_model=SyncJobRead)
def get_sync_job(job_id: str, credential: Credential = Depends(owned_credential)) -> SyncJobRead:
    job = sync_jobs.get_job_by_id(job_id)
    if job is None or job.credential_id != credential.id:
        raise NotFoundError(f"Sync job {job_id} not found for {credential}")
    return SyncJobRead.model_validate(job)


@router.delete("/{credential_id}/sync/{job_id}", status_code=204)
async def cancel_sync_job(job_id: str, credential: Credential = Depends(owned_credential)) -> None:
    job = sync_jobs.get_job_by_id(job_id)
    if job is None or job.credential_id != credential.id:
        raise NotFoundError(f"Sync job {job_id} not found for {credential}")
    await sync_jobs.cancel(job_id=job_id)


@router.post("/{credential_id}/sync/{job_id}/2fa", response_model=SyncJobRead, status_code=202)
async def submit_sync_two_factor(
    job_id: str,
    payload: TwoFactorCode,
    credential: Credential = Depends(owned_credential),
) -> SyncJobRead:
    existing = sync_jobs.get_job_by_id(job_id)
    if existing is None or existing.credential_id != credential.id:
        raise NotFoundError(f"Sync job {job_id} not found for {credential}")
    job = await sync_jobs.submit_two_factor(job_id=job_id, code=payload.code)
    if job is None:
        raise InvalidTwoFactorError(f"Sync job {job_id} is not awaiting a 2FA code")
    return SyncJobRead.model_validate(job)
