import asyncio
from dataclasses import asdict

from fastapi import Depends, WebSocket, WebSocketDisconnect
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
    CredentialNotFoundError,
    InvalidTwoFactorError,
    NotFoundError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.services.auth import session_service
from source.backend.services.banking import credential_service, sync_jobs
from source.backend.services.banking.sync_jobs import SyncJob

logger = get_logger(__name__)

router = create_router()

WS_CODE_CLOSE_UNAUTHENTICATED = 4401
WS_CODE_CLOSE_NOT_FOUND = 4404


def _job_to_response(job: SyncJob) -> SyncJobRead:
    return SyncJobRead.model_validate(job)


def _get_job_payload(job: SyncJob) -> dict:
    payload = asdict(job)
    payload.pop("challenge_token", None)  # internal — never leaves the backend
    payload["status"] = job.status.value
    payload["error_code"] = job.error_code.value if job.error_code else None
    for key in ("started_at", "finished_at", "expires_at"):
        value = payload.get(key)
        if value is not None:
            payload[key] = value.isoformat()
    return payload


@router.get("/supported_banks")
def list_supported_banks(_: User = Depends(session_service.get_current_user_from_request)) -> list[dict]:
    return credential_service.list_all_possible()


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


@router.get("/{credential_id}", response_model=CredentialRead)
def get_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    return credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user=current_user
    )


@router.patch("/{credential_id}", response_model=CredentialRead)
def update_credential(
    credential_id: int,
    payload: CredentialUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Credential:
    credential = credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user=current_user
    )
    return credential_service.update_credential(
        db_session=db_session, credential=credential, fields=payload.model_dump(exclude_unset=True)
    )


@router.delete("/{credential_id}", status_code=204)
def delete_credential(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    credential = credential_service.get_credential_for_user(
        db_session=db_session, credential_id=credential_id, user=current_user
    )
    credential_service.delete_credential(db_session=db_session, credential=credential)


@router.post("/{credential_id}/sync", response_model=SyncJobRead, status_code=202)
async def start_sync(
    credential_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> SyncJobRead:
    credential_service.get_credential_for_user(db_session=db_session, credential_id=credential_id, user=current_user)
    job = await sync_jobs.start_sync(credential_id=credential_id)
    return _job_to_response(job)


@router.get("/{credential_id}/sync/{job_id}", response_model=SyncJobRead)
def get_sync_job(
    credential_id: int,
    job_id: str,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> SyncJobRead:
    credential_service.get_credential_for_user(db_session=db_session, credential_id=credential_id, user=current_user)
    job = sync_jobs.get_job_by_id(job_id)
    if job is None or job.credential_id != credential_id:
        raise NotFoundError(f"Sync job {job_id} not found for credential {credential_id}")
    return _job_to_response(job)


@router.post("/{credential_id}/sync/{job_id}/2fa", response_model=SyncJobRead, status_code=202)
async def submit_sync_two_factor(
    credential_id: int,
    job_id: str,
    payload: TwoFactorCode,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> SyncJobRead:
    credential_service.get_credential_for_user(db_session=db_session, credential_id=credential_id, user=current_user)
    existing = sync_jobs.get_job_by_id(job_id)
    if existing is None or existing.credential_id != credential_id:
        raise NotFoundError(f"Sync job {job_id} not found for credential {credential_id}")
    job = await sync_jobs.submit_two_factor(job_id=job_id, code=payload.code)
    if job is None:
        raise InvalidTwoFactorError(f"Sync job {job_id} is not awaiting a 2FA code")
    return _job_to_response(job)


@router.websocket("/{credential_id}/sync/{job_id}/ws")
async def sync_job_ws(
    websocket: WebSocket,
    credential_id: int,
    job_id: str,
    db_session: Session = Depends(get_session),
) -> None:
    raw_token = websocket.cookies.get(session_service.COOKIE_NAME)
    if not raw_token:
        logger.info(
            f"WS /credentials/{credential_id}/sync/{job_id}/ws -> {WS_CODE_CLOSE_UNAUTHENTICATED} (no session cookie)"
        )
        await websocket.close(code=WS_CODE_CLOSE_UNAUTHENTICATED)
        return
    user = session_service.get_user_by_raw_token(db_session=db_session, raw_token=raw_token)
    if user is None:
        logger.info(
            f"WS /credentials/{credential_id}/sync/{job_id}/ws -> {WS_CODE_CLOSE_UNAUTHENTICATED} (invalid session)"
        )
        await websocket.close(code=WS_CODE_CLOSE_UNAUTHENTICATED)
        return
    try:
        credential_service.get_credential_for_user(db_session=db_session, credential_id=credential_id, user=user)
    except CredentialNotFoundError:
        logger.info(
            f"WS /credentials/{credential_id}/sync/{job_id}/ws -> {WS_CODE_CLOSE_NOT_FOUND} (credential not found)"
        )
        await websocket.close(code=WS_CODE_CLOSE_NOT_FOUND)
        return

    job = sync_jobs.get_job_by_id(job_id)
    if job is None or job.credential_id != credential_id:
        logger.info(f"WS /credentials/{credential_id}/sync/{job_id}/ws -> {WS_CODE_CLOSE_NOT_FOUND} (job not found)")
        await websocket.close(code=WS_CODE_CLOSE_NOT_FOUND)
        return

    await websocket.accept()
    forward_task = asyncio.create_task(_forward_job_updates(websocket=websocket, job_id=job_id))
    receive_task = asyncio.create_task(websocket.receive())
    try:
        done, _ = await asyncio.wait({forward_task, receive_task}, return_when=asyncio.FIRST_COMPLETED)  # noqa FKA100
    except asyncio.CancelledError:
        logger.info(f"WS for sync job {job_id} cancelled during server shutdown")
        forward_task.cancel()
        receive_task.cancel()
        raise
    forward_task.cancel()
    receive_task.cancel()
    if forward_task in done:
        try:
            forward_task.result()
        except WebSocketDisconnect:
            logger.debug(f"WebSocket client disconnected from sync job {job_id}")
    else:
        logger.debug(f"WebSocket client disconnected from sync job {job_id}")


async def _forward_job_updates(websocket: WebSocket, job_id: str) -> None:
    async for update in sync_jobs.subscribe(job_id):
        payload = _get_job_payload(update)
        logger.debug(f"WS job {job_id} -> {payload}")
        await websocket.send_json(payload)
        if update.finished_at is not None:
            break
