import asyncio
import secrets
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field, fields, replace
from datetime import datetime, timedelta
from enum import Enum
from typing import ClassVar

from source.backend.db import SessionLocal
from source.backend.exceptions import InvalidCredentialsError
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.base import format_repr
from source.backend.services import credential_service
from source.backend.services.credential_service import SyncResult, SyncStatus

logger = get_logger(__name__)

JOB_RETENTION_DURATION = timedelta(hours=1)


class JobStatus(str, Enum):
    RUNNING = "running"
    AWAITING_TWO_FACTOR = "awaiting_2fa"
    AWAITING_DECOUPLED_APPROVAL = "awaiting_decoupled_approval"
    COMPLETED = "completed"
    FAILED = "failed"


class JobErrorCode(str, Enum):
    INVALID_CREDENTIALS = "invalid_credentials"
    UNKNOWN = "unknown"


TERMINAL_JOB_STATUSSES = frozenset({JobStatus.COMPLETED, JobStatus.FAILED})


@dataclass
class SyncJob:
    __repr_exclude__: ClassVar[frozenset[str]] = frozenset({"challenge_token"})

    job_id: str
    credential_id: int
    status: JobStatus = JobStatus.RUNNING
    challenge_token: str | None = None
    expires_at: datetime | None = None
    error: str | None = None
    error_code: JobErrorCode | None = None
    started_at: datetime = field(default_factory=utc_now)
    finished_at: datetime | None = None

    def __repr__(self) -> str:
        return format_repr(obj=self, field_names=(f.name for f in fields(self)), excluded=type(self).__repr_exclude__)


_jobs: dict[str, SyncJob] = {}
_subscribers: dict[str, set[asyncio.Queue[SyncJob]]] = {}
_lock = asyncio.Lock()
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro: "asyncio.coroutines.Coroutine") -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _cleanup_old_jobs() -> None:
    cutoff_time = utc_now() - JOB_RETENTION_DURATION
    stale_jobs = [job_id for job_id, job in _jobs.items() if job.finished_at and job.finished_at < cutoff_time]
    for job_id in stale_jobs:
        _jobs.pop(job_id, None)
        _subscribers.pop(job_id, None)


def get_job_by_id(job_id: str) -> SyncJob | None:
    return _jobs.get(job_id)


async def _notify(job: SyncJob) -> None:
    async with _lock:
        snapshot = replace(job)
        queues = list(_subscribers.get(job.job_id, set()))  # noqa FKA100
    for queue in queues:
        await queue.put(snapshot)


async def start_sync(credential_id: int) -> SyncJob:
    _cleanup_old_jobs()
    job = SyncJob(job_id=secrets.token_urlsafe(16), credential_id=credential_id)
    _jobs[job.job_id] = job
    logger.info(f"Sync job {job} started")
    _spawn(_run_sync(job))
    # Yield once so the background task gets a chance to start before we return.
    await asyncio.sleep(0)
    return job


async def _run_sync(job: SyncJob) -> None:
    notify_two_factor_state = _make_two_factor_state_notifier(job)
    try:
        result = await asyncio.to_thread(_sync_in_thread, job.credential_id, notify_two_factor_state)  # noqa FKA100
        _apply_result(job=job, result=result)
    except InvalidCredentialsError as e:
        logger.warning(f"Sync job {job} failed: invalid credentials")
        _mark_terminal(job=job, status=JobStatus.FAILED, error=str(e), error_code=JobErrorCode.INVALID_CREDENTIALS)
    except Exception as e:
        logger.exception(f"Sync job {job} failed")
        _mark_terminal(job=job, status=JobStatus.FAILED, error=str(e), error_code=JobErrorCode.UNKNOWN)
    await _notify(job)


def _make_two_factor_state_notifier(job: SyncJob) -> "Callable[[bool], None]":
    # Invoked from the worker thread that runs the blocking sync. Schedules a
    # state update on the event loop so subscribers (e.g., the WebSocket) see
    # the awaiting / running transition while the sync is still in flight.
    loop = asyncio.get_running_loop()

    def notify(awaiting: bool) -> None:
        asyncio.run_coroutine_threadsafe(_update_decoupled_state(job=job, awaiting=awaiting), loop)  # noqa FKA100

    return notify


async def _update_decoupled_state(job: SyncJob, awaiting: bool) -> None:
    # Don't override a terminal status (could race with completion).
    if job.status in TERMINAL_JOB_STATUSSES:
        return
    job.status = JobStatus.AWAITING_DECOUPLED_APPROVAL if awaiting else JobStatus.RUNNING
    await _notify(job)


def _sync_in_thread(credential_id: int, notify_two_factor_state: "Callable[[bool], None] | None" = None) -> SyncResult:
    with SessionLocal() as db_session:
        return credential_service.sync_credential(
            db_session=db_session, credential_id=credential_id, notify_two_factor_state=notify_two_factor_state
        )


def _apply_result(job: SyncJob, result: SyncResult) -> None:
    if result.status == SyncStatus.TWO_FACTOR_REQUIRED:
        job.status = JobStatus.AWAITING_TWO_FACTOR
        job.challenge_token = result.challenge_token
        job.expires_at = result.expires_at
        logger.info(f"Sync job {job} awaiting 2FA")
    else:
        _mark_terminal(job=job, status=JobStatus.COMPLETED)
        logger.info(f"Sync job {job} completed")


def _mark_terminal(
    job: SyncJob, status: JobStatus, error: str | None = None, error_code: JobErrorCode | None = None
) -> None:
    job.status = status
    job.error = error
    job.error_code = error_code
    job.finished_at = utc_now()


async def submit_two_factor(job_id: str, code: str) -> SyncJob | None:
    job = _jobs.get(job_id)
    if job is None or job.status != JobStatus.AWAITING_TWO_FACTOR or job.challenge_token is None:
        return None
    challenge_token = job.challenge_token
    job.status = JobStatus.RUNNING
    job.challenge_token = None
    _spawn(_run_confirm(job, challenge_token=challenge_token, code=code))
    # Yield once so the background task gets a chance to start before we return.
    await asyncio.sleep(0)
    return job


async def _run_confirm(job: SyncJob, challenge_token: str, code: str) -> None:
    await _notify(job)  # broadcast the running state before kicking off the blocking call
    try:
        result = await asyncio.to_thread(  # noqa FKA100
            _confirm_in_thread, job.credential_id, challenge_token=challenge_token, code=code
        )
        _apply_result(job=job, result=result)
    except InvalidCredentialsError as e:
        logger.warning(f"Sync job {job} 2FA confirmation failed: invalid credentials")
        _mark_terminal(job=job, status=JobStatus.FAILED, error=str(e), error_code=JobErrorCode.INVALID_CREDENTIALS)
    except Exception as e:
        logger.exception(f"Sync job {job} 2FA confirmation failed")
        _mark_terminal(job=job, status=JobStatus.FAILED, error=str(e), error_code=JobErrorCode.UNKNOWN)
    await _notify(job)


def _confirm_in_thread(credential_id: int, challenge_token: str, code: str) -> SyncResult:
    with SessionLocal() as db_session:
        return credential_service.confirm_two_factor(
            db_session=db_session, credential_id=credential_id, challenge_token=challenge_token, code=code
        )


async def subscribe(job_id: str) -> AsyncIterator[SyncJob]:
    queue: asyncio.Queue[SyncJob] = asyncio.Queue()
    async with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        snapshot = replace(job)
        _subscribers.setdefault(job_id, set()).add(queue)  # noqa FKA100
    try:
        yield snapshot
        if snapshot.finished_at is not None:
            return
        while True:
            update = await queue.get()
            yield update
            if update.finished_at is not None:
                return
    finally:
        async with _lock:
            queues = _subscribers.get(job_id)
            if queues:
                queues.discard(queue)
                if not queues:
                    _subscribers.pop(job_id, None)
