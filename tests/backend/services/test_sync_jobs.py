import asyncio
from collections.abc import Callable, Iterator
from datetime import timedelta
from typing import Union

import pytest
from source.backend.exceptions import InvalidCredentialsError
from source.backend.helpers import utc_now
from source.backend.services import sync_jobs
from source.backend.services.credential_service import SyncResult, SyncStatus
from source.backend.services.sync_jobs import JobErrorCode, JobStatus, SyncJob

from tests.backend.conftest import CHALLENGE_TOKEN

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
    sync_jobs._subscribers.clear()
    yield
    sync_jobs._jobs.clear()
    sync_jobs._subscribers.clear()


@pytest.fixture
def patch_sync(monkeypatch: pytest.MonkeyPatch) -> PatchSync:
    def patch(outcome: SyncOutcome) -> None:
        def _runner(credential_id: int, notify_two_factor_state: object = None) -> SyncResult:
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(target=sync_jobs, name="_sync_in_thread", value=_runner)

    return patch


@pytest.fixture
def patch_confirm(monkeypatch: pytest.MonkeyPatch) -> PatchConfirm:
    def patch(outcome: SyncOutcome) -> None:
        def _runner(credential_id: int, challenge_token: str, code: str) -> SyncResult:
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(target=sync_jobs, name="_confirm_in_thread", value=_runner)

    return patch


def test_start_sync_creates_a_job_that_runs_to_completion(patch_sync: PatchSync):
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


def test_start_sync_marks_job_failed_on_exception(patch_sync: PatchSync):
    patch_sync(RuntimeError("Something went wrong"))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        for _ in range(50):
            if job.finished_at is not None:
                break
            await asyncio.sleep(0)
        assert job.status == JobStatus.FAILED
        assert "Something went wrong" in (job.error or "")

    asyncio.run(scenario())


def test_start_sync_tags_invalid_credentials_with_error_code(patch_sync: PatchSync):
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


def test_start_sync_tags_unexpected_failure_with_unknown_error_code(patch_sync: PatchSync):
    patch_sync(RuntimeError("boom"))

    async def scenario():
        job = await sync_jobs.start_sync(credential_id=42)
        for _ in range(50):
            if job.finished_at is not None:
                break
            await asyncio.sleep(0)
        assert job.status == JobStatus.FAILED
        assert job.error_code == JobErrorCode.UNKNOWN

    asyncio.run(scenario())


def test_start_sync_holds_awaiting_two_factor(patch_sync: PatchSync):
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


def test_subscribe_yields_terminal_state_for_finished_job():
    job = SyncJob(job_id="abc", credential_id=1, status=JobStatus.COMPLETED, finished_at=utc_now())
    sync_jobs._jobs[job.job_id] = job

    async def scenario() -> list[SyncJob]:
        updates: list[SyncJob] = []
        async for update in sync_jobs.subscribe(job.job_id):
            updates.append(update)
        return updates

    updates = asyncio.run(scenario())
    assert len(updates) == 1
    assert updates[0].status == JobStatus.COMPLETED


def test_subscribe_streams_updates_as_they_happen(patch_sync: PatchSync):
    patch_sync(SyncResult(status=SyncStatus.COMPLETED))

    async def scenario() -> list[JobStatus]:
        job = await sync_jobs.start_sync(credential_id=42)
        statuses: list[JobStatus] = []
        async for update in sync_jobs.subscribe(job.job_id):
            statuses.append(update.status)
            if update.finished_at is not None:
                break
        return statuses

    statuses = asyncio.run(scenario())
    assert statuses[-1] == JobStatus.COMPLETED
    # The first snapshot is RUNNING (subscribe is invoked before the background task finishes)
    # or COMPLETED (the task already finished). Either is correct; only the terminal state matters.
    assert all(status in {JobStatus.RUNNING, JobStatus.COMPLETED} for status in statuses)


def test_subscribe_returns_immediately_for_unknown_job():
    async def scenario() -> list[SyncJob]:
        return [update async for update in sync_jobs.subscribe("missing")]

    assert asyncio.run(scenario()) == []


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
