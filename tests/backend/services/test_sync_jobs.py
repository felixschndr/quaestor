import asyncio
import time
from collections.abc import Callable, Iterator
from datetime import timedelta
from typing import Union

import pytest

from source.backend.exceptions import BankRateLimitedError, InvalidCredentialsError, SyncCancelledError
from source.backend.helpers import utc_now
from source.backend.services.banking import sync_jobs
from source.backend.services.banking.credential_service import SyncResult, SyncStatus
from source.backend.services.banking.sync_jobs import JobErrorCode, JobStatus, SyncJob
from tests.backend.conftest import CHALLENGE_TOKEN, assert_log_contains

SyncOutcome = Union[SyncResult, Exception]
PatchSync = Callable[[SyncOutcome], None]
PatchConfirm = Callable[[SyncOutcome], None]


async def _wait_until(predicate: Callable[[], bool]) -> None:
    deadline = asyncio.get_running_loop().time() + 5
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            return
        await asyncio.sleep(0.01)


@pytest.fixture(autouse=True)
def _reset_state() -> Iterator[None]:
    sync_jobs._jobs.clear()
    yield
    sync_jobs._jobs.clear()


@pytest.fixture
def patch_sync(monkeypatch: pytest.MonkeyPatch) -> PatchSync:
    def patch(outcome: SyncOutcome) -> None:
        def _runner(
            credential_id: int, notify_two_factor_state: object = None, is_cancelled: object = None
        ) -> SyncResult:
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(target=sync_jobs, name="_sync_in_thread", value=_runner)

    return patch


@pytest.fixture
def patch_confirm(monkeypatch: pytest.MonkeyPatch) -> PatchConfirm:
    def patch(outcome: SyncOutcome) -> None:
        def _runner(
            credential_id: int,
            challenge_token: str,
            code: str,
            notify_two_factor_state: "Callable[[bool], None] | None" = None,
        ) -> SyncResult:
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(target=sync_jobs, name="_confirm_in_thread", value=_runner)

    return patch


def test_start_sync_creates_a_job_that_runs_to_completion(patch_sync: PatchSync, caplog: pytest.LogCaptureFixture):
    patch_sync(SyncResult(status=SyncStatus.COMPLETED))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        assert job.credential_id == 42
        assert sync_jobs.get_job_by_id(job.job_id) is job
        # start_sync yields once before returning, so the background task may have already
        # progressed to terminal — only assert the eventual outcome.
        for _ in range(50):
            if job.finished_at is not None:
                break
            await asyncio.sleep(0)
        assert job.status == JobStatus.COMPLETED

    asyncio.run(scenario())

    assert_log_contains(caplog, messages=["started", "completed"])


def test_start_sync_marks_job_failed_on_exception(patch_sync: PatchSync, caplog: pytest.LogCaptureFixture):
    patch_sync(RuntimeError("Something went wrong"))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        for _ in range(50):
            if job.finished_at is not None:
                break
            await asyncio.sleep(0)
        assert job.status == JobStatus.FAILED
        assert "Something went wrong" in (job.error or "")
        assert job.error_code == JobErrorCode.UNKNOWN  # unexpected failures are tagged UNKNOWN

    asyncio.run(scenario())

    assert_log_contains(caplog, message="failed")


def test_start_sync_tags_invalid_credentials_with_error_code(patch_sync: PatchSync, caplog: pytest.LogCaptureFixture):
    patch_sync(InvalidCredentialsError("The bank rejected the login"))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        for _ in range(50):
            if job.finished_at is not None:
                break
            await asyncio.sleep(0)
        assert job.status == JobStatus.FAILED
        assert job.error_code == JobErrorCode.INVALID_CREDENTIALS
        assert "rejected the login" in (job.error or "")

    asyncio.run(scenario())

    assert_log_contains(caplog, message="failed: The bank rejected the login")


def test_start_sync_holds_awaiting_two_factor(patch_sync: PatchSync, caplog: pytest.LogCaptureFixture):
    expires = utc_now() + timedelta(minutes=5)
    patch_sync(SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN, expires_at=expires))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        for _ in range(50):
            if job.status == JobStatus.AWAITING_TWO_FACTOR:
                break
            await asyncio.sleep(0)
        assert job.status == JobStatus.AWAITING_TWO_FACTOR
        assert job.challenge_token == CHALLENGE_TOKEN
        assert job.expires_at == expires
        assert job.finished_at is None  # awaiting_2fa is not terminal

    asyncio.run(scenario())

    assert_log_contains(caplog, message="awaiting 2FA")


def test_submit_two_factor_advances_the_job(patch_sync: PatchSync, patch_confirm: PatchConfirm):
    patch_sync(SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN))
    patch_confirm(SyncResult(status=SyncStatus.COMPLETED))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: job.status == JobStatus.AWAITING_TWO_FACTOR)

        result = await sync_jobs.submit_two_factor(job_id=job.job_id, code="1234")
        assert result is job
        assert job.status == JobStatus.RUNNING
        assert job.challenge_token is None  # consumed

        await _wait_until(lambda: job.finished_at is not None)
        assert job.status == JobStatus.COMPLETED

    asyncio.run(scenario())


def test_submit_two_factor_returns_none_when_job_not_awaiting():
    job = SyncJob(job_id="abc", credential_id=1, status=JobStatus.RUNNING)
    sync_jobs._jobs[job.job_id] = job

    async def scenario():
        assert await sync_jobs.submit_two_factor(job_id=job.job_id, code="x") is None

    asyncio.run(scenario())


def test_start_sync_runs_to_completion(patch_sync: PatchSync):
    patch_sync(SyncResult(status=SyncStatus.COMPLETED))

    async def scenario() -> JobStatus:
        job = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: job.finished_at is not None)
        return job.status

    assert asyncio.run(scenario()) == JobStatus.COMPLETED


def test_start_sync_supersedes_a_running_job_for_the_same_credential(
    patch_sync: PatchSync, caplog: pytest.LogCaptureFixture
):
    # Issue #119: starting a new sync must stop the still-running one for that credential.
    patch_sync(SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN))

    async def scenario() -> tuple[SyncJob, SyncJob]:
        first = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: first.status == JobStatus.AWAITING_TWO_FACTOR)
        second = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: second.status == JobStatus.AWAITING_TWO_FACTOR)
        return first, second

    first, second = asyncio.run(scenario())
    assert first.status == JobStatus.FAILED
    assert first.error_code == JobErrorCode.CANCELLED
    assert second is not first
    assert second.status == JobStatus.AWAITING_TWO_FACTOR
    assert sync_jobs.get_job_by_id(second.job_id) is second
    assert_log_contains(caplog, message="is superseded by a new sync for the credential 42")


def test_start_sync_leaves_other_credentials_running(patch_sync: PatchSync):
    patch_sync(SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN))

    async def scenario() -> tuple[SyncJob, SyncJob]:
        other = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: other.status == JobStatus.AWAITING_TWO_FACTOR)
        new = await sync_jobs.start_sync(credential_id=43)
        await _wait_until(lambda: new.status == JobStatus.AWAITING_TWO_FACTOR)
        return other, new

    other, new = asyncio.run(scenario())
    assert other.status == JobStatus.AWAITING_TWO_FACTOR  # untouched: different credential
    assert new.status == JobStatus.AWAITING_TWO_FACTOR


def test_cleanup_drops_old_finished_jobs():
    fresh = SyncJob(job_id="fresh", credential_id=1, status=JobStatus.COMPLETED, finished_at=utc_now())
    stale = SyncJob(
        job_id="stale",
        credential_id=1,
        status=JobStatus.COMPLETED,
        finished_at=utc_now() - sync_jobs.JOB_RETENTION_DURATION - timedelta(minutes=1),
    )
    sync_jobs._jobs[fresh.job_id] = fresh
    sync_jobs._jobs[stale.job_id] = stale

    sync_jobs._cleanup_old_jobs()

    assert sync_jobs.get_job_by_id(fresh.job_id) is fresh
    assert sync_jobs.get_job_by_id(stale.job_id) is None


def test_cancel_marks_awaiting_job_failed(patch_sync: PatchSync, caplog: pytest.LogCaptureFixture):
    patch_sync(SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN))

    async def scenario() -> SyncJob:
        job = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: job.status == JobStatus.AWAITING_TWO_FACTOR)
        await sync_jobs.cancel(job_id=job.job_id)
        return job

    job = asyncio.run(scenario())
    assert job.status == JobStatus.FAILED
    assert job.error_code == JobErrorCode.CANCELLED
    assert job.challenge_token is None
    assert_log_contains(caplog, message="cancelled")


def test_cancel_aborts_a_blocking_sync_and_keeps_cancelled_status(monkeypatch: pytest.MonkeyPatch):
    def blocking_runner(
        credential_id: int,
        notify_two_factor_state: Callable[[bool], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> SyncResult:
        if notify_two_factor_state is not None:
            notify_two_factor_state(True)  # -> awaiting_decoupled_approval
        while not (is_cancelled and is_cancelled()):
            time.sleep(0.01)
        raise SyncCancelledError("cancelled while waiting for pushTAN approval")

    monkeypatch.setattr(target=sync_jobs, name="_sync_in_thread", value=blocking_runner)

    async def scenario() -> SyncJob:
        job = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: job.status == JobStatus.AWAITING_DECOUPLED_APPROVAL)
        await sync_jobs.cancel(job_id=job.job_id)
        await _wait_until(lambda: not sync_jobs._background_tasks)
        return job

    job = asyncio.run(scenario())
    assert job.status == JobStatus.FAILED
    assert job.error_code == JobErrorCode.CANCELLED  # not overwritten by the thread's SyncCancelledError


def test_cancel_ignores_unknown_and_terminal_jobs():
    done = SyncJob(job_id="done", credential_id=1, status=JobStatus.COMPLETED, finished_at=utc_now())
    sync_jobs._jobs[done.job_id] = done

    assert asyncio.run(sync_jobs.cancel(job_id="missing")) is None
    assert asyncio.run(sync_jobs.cancel(job_id=done.job_id)) is None
    assert done.status == JobStatus.COMPLETED


def test_cleanup_fails_expired_two_factor_jobs():
    expired = SyncJob(
        job_id="expired",
        credential_id=1,
        status=JobStatus.AWAITING_TWO_FACTOR,
        expires_at=utc_now() - timedelta(minutes=1),
    )
    sync_jobs._jobs[expired.job_id] = expired

    sync_jobs._cleanup_old_jobs()

    assert expired.status == JobStatus.FAILED
    assert expired.finished_at is not None


def test_rate_limit_is_reported_as_rate_limited_error_code(patch_sync: PatchSync):
    patch_sync(BankRateLimitedError("429"))

    async def scenario() -> SyncJob:
        job = await sync_jobs.start_sync(credential_id=42)
        await _wait_until(lambda: job.finished_at is not None)
        return job

    job = asyncio.run(scenario())
    assert job.status == JobStatus.FAILED
    assert job.error_code == JobErrorCode.RATE_LIMITED
