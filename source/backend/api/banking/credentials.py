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
from source.backend.exceptions import InvalidTwoFactorError, NotFoundError, PermissionDeniedError
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


def _job_read(job: sync_jobs.SyncJob, credential: Credential, user: User) -> SyncJobRead:
    read = SyncJobRead.model_validate(job)
    if credential.user_id != user.id:
        read.error = None
        read.authorization_url = None
        read.device_code = None
    return read


@router.get("/sync", response_model=list[SyncJobRead])
def list_sync_jobs(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[SyncJobRead]:
    syncable = {
        credential.id: credential
        for credential in credential_service.list_syncable_credentials(db_session=db_session, user=current_user)
    }
    jobs = sync_jobs.get_jobs_for_credentials(set(syncable))
    return [_job_read(job=job, credential=syncable[job.credential_id], user=current_user) for job in jobs]


def owned_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user=current_user
    )


def syncable_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.get_syncable_credential_for_user(
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
async def start_sync(
    credential: Credential = Depends(syncable_credential),
    current_user: User = Depends(session_service.get_current_user_from_request),
) -> SyncJobRead:
    if not credential.is_syncable:
        raise PermissionDeniedError(f"{credential} cannot be synced; it is a manual credential")
    job = await sync_jobs.start_sync(credential_id=credential.id)
    return _job_read(job=job, credential=credential, user=current_user)


@router.get("/{credential_id}/sync/{job_id}", response_model=SyncJobRead)
def get_sync_job(
    job_id: str,
    credential: Credential = Depends(syncable_credential),
    current_user: User = Depends(session_service.get_current_user_from_request),
) -> SyncJobRead:
    job = sync_jobs.get_job_by_id(job_id)
    if job is None or job.credential_id != credential.id:
        raise NotFoundError(f"Sync job {job_id} not found for {credential}")
    return _job_read(job=job, credential=credential, user=current_user)


@router.delete("/{credential_id}/sync/{job_id}", status_code=204)
async def cancel_sync_job(job_id: str, credential: Credential = Depends(syncable_credential)) -> None:
    job = sync_jobs.get_job_by_id(job_id)
    if job is None or job.credential_id != credential.id:
        raise NotFoundError(f"Sync job {job_id} not found for {credential}")
    await sync_jobs.cancel(job_id=job_id)


@router.post("/{credential_id}/sync/{job_id}/2fa", response_model=SyncJobRead, status_code=202)
async def submit_sync_two_factor(
    job_id: str,
    payload: TwoFactorCode,
    credential: Credential = Depends(syncable_credential),
    current_user: User = Depends(session_service.get_current_user_from_request),
) -> SyncJobRead:
    existing = sync_jobs.get_job_by_id(job_id)
    if existing is None or existing.credential_id != credential.id:
        raise NotFoundError(f"Sync job {job_id} not found for {credential}")
    if credential.user_id != current_user.id:
        raise PermissionDeniedError(f"Only the owner of {credential} can answer its second factor")
    job = await sync_jobs.submit_two_factor(job_id=job_id, code=payload.code)
    if job is None:
        raise InvalidTwoFactorError(f"Sync job {job_id} is not awaiting a 2FA code")
    return _job_read(job=job, credential=credential, user=current_user)
