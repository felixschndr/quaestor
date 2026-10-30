import asyncio
from datetime import timedelta
from types import ModuleType
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import sessionmaker

from source.backend.services.banking import sync_scheduler
from source.backend.services.banking.sync_scheduler import run_periodic_sync as real_run_periodic_sync
from source.backend.services.transactions import recurring_transaction_scheduler
from tests.backend.conftest import assert_log_contains


def test_default_interval_is_twelve_hours(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, raising=False)

    assert sync_scheduler._sync_interval() == timedelta(hours=12)


def test_interval_is_read_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, value="0.5")

    assert sync_scheduler._sync_interval() == timedelta(minutes=30)


def test_invalid_interval_falls_back_to_default(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    monkeypatch.setenv(name=sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, value="not-a-number")

    assert sync_scheduler._sync_interval() == sync_scheduler.DEFAULT_SYNC_INTERVAL

    assert_log_contains(
        caplog,
        message=f"Invalid {sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME}='not-a-number'; "
        "falling back to 12:00:00",
    )


@pytest.mark.parametrize(
    argnames=("scheduler", "service", "job", "helper"),
    argvalues=[
        (sync_scheduler, sync_scheduler.credential_service, "sync_all_due_credentials", "_sync_all_due_credentials"),
        (
            recurring_transaction_scheduler,
            recurring_transaction_scheduler.recurring_transaction_service,
            "book_due_recurring_transactions",
            "_book_due_recurring_transactions",
        ),
    ],
)
def test_scheduler_helper_runs_its_job_in_a_session_local(
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    scheduler: ModuleType,
    service: ModuleType,
    job: str,
    helper: str,
):
    monkeypatch.setattr(target=scheduler, name="SessionLocal", value=session_factory)
    job_mock = Mock()
    monkeypatch.setattr(target=service, name=job, value=job_mock)

    getattr(scheduler, helper)()

    job_mock.assert_called_once()


def test_run_periodic_sync_logs_and_keeps_running_on_exception(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    class _StopLoop(Exception):
        pass

    sync_mock = Mock(side_effect=RuntimeError("sync failed"))
    monkeypatch.setattr(target=sync_scheduler, name="_sync_all_due_credentials", value=sync_mock)

    sleep_calls = 0

    async def fake_sleep(_seconds: float):  # noqa: ASYNC124
        nonlocal sleep_calls
        sleep_calls += 1
        if sleep_calls > 1:
            raise _StopLoop

    monkeypatch.setattr(target=sync_scheduler.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_sync())

    assert_log_contains(caplog, message="Periodic credential sync run crashed")


def test_run_periodic_sync_calls_the_sync_function(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    class _StopLoop(Exception):
        pass

    sync = Mock()
    monkeypatch.setattr(target=sync_scheduler, name="_sync_all_due_credentials", value=sync)

    async def fake_sleep(_seconds: float):  # noqa: ASYNC124
        # The loop sleeps before each sync; trip the loop on the second sleep so
        # exactly one sync runs in between.
        if sync.called:
            raise _StopLoop

    monkeypatch.setattr(target=sync_scheduler.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_sync())

    sync.assert_called_once_with()
    assert_log_contains(caplog, message="Periodic credential sync scheduled")
