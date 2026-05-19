import asyncio
import threading
from datetime import timedelta
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from source.backend import main
from source.backend.services import sync_scheduler
from source.backend.services.sync_scheduler import (
    run_periodic_sync as real_run_periodic_sync,
)
from sqlalchemy.orm import sessionmaker


def test_default_interval_is_twelve_hours(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, raising=False)

    assert sync_scheduler._sync_interval() == timedelta(hours=12)


def test_interval_is_read_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, value="0.5")

    assert sync_scheduler._sync_interval() == timedelta(minutes=30)


def test_invalid_interval_falls_back_to_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=sync_scheduler.SYNC_INTERVAL_HOURS_ENV_VARIABLE_NAME, value="not-a-number")

    assert sync_scheduler._sync_interval() == sync_scheduler.DEFAULT_SYNC_INTERVAL


def test_app_startup_schedules_periodic_sync(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    scheduled = threading.Event()
    run_periodic_sync = AsyncMock(side_effect=lambda: scheduled.set())
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=run_periodic_sync)

    with TestClient(main.app):
        assert scheduled.wait(timeout=5)

    run_periodic_sync.assert_called_once_with()


def test_run_periodic_sync_calls_the_sync_function(monkeypatch: pytest.MonkeyPatch):
    class _StopLoop(Exception):
        pass

    sync = Mock()
    monkeypatch.setattr(target=sync_scheduler, name="_sync_all_due_credentials", value=sync)

    async def fake_sleep(_seconds: float) -> None:  # noqa: ASYNC124
        raise _StopLoop  # break out of the otherwise-infinite loop after the first run

    monkeypatch.setattr(target=sync_scheduler.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_sync())

    sync.assert_called_once_with()
