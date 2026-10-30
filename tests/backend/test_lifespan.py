import asyncio
import threading
from collections.abc import Awaitable, Callable
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend import main
from tests.backend.conftest import assert_log_contains


def test_lifespan_runs_alembic_upgrade_before_serving_requests(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    upgrade = MagicMock()
    monkeypatch.setattr(target=main.migrations, name="upgrade_to_head", value=upgrade)

    with TestClient(main.app):
        upgrade.assert_called_once_with()


@pytest.mark.parametrize(
    argnames=("module", "name"),
    argvalues=main.STARTUP_BACKGROUND_TASKS,
    ids=[f"{module.__name__.rsplit('.', maxsplit=1)[-1]}.{name}" for module, name in main.STARTUP_BACKGROUND_TASKS],
)
def test_app_startup_schedules_background_task(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, module: ModuleType, name: str
):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    scheduled = threading.Event()
    task = AsyncMock(side_effect=lambda: scheduled.set())
    monkeypatch.setattr(target=module, name=name, value=task)

    with TestClient(main.app):
        assert scheduled.wait(timeout=5)

    task.assert_called_once_with()


def test_lifespan_cancels_background_tasks_before_disposing_the_db_engine(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    # Order matters: finish background tasks (which may hold sessions) first
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    call_order: list[str] = []
    started = {"rescan": threading.Event(), "sync": threading.Event()}

    def fake_task(label: str) -> Callable[[], Awaitable[None]]:
        async def run() -> None:
            started[label].set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                call_order.append(f"{label}_cancelled")
                raise

        return run

    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=fake_task("rescan"))
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=fake_task("sync"))
    monkeypatch.setattr(target=main, name="close_engine", value=lambda: call_order.append("engine_closed"))

    with TestClient(main.app):
        assert started["rescan"].wait(timeout=5)
        assert started["sync"].wait(timeout=5)

    assert sorted(call_order[:2]) == ["rescan_cancelled", "sync_cancelled"], "background tasks were not cancelled"
    assert call_order[2:] == ["engine_closed"]


def test_lifespan_closes_db_on_shutdown(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    close = MagicMock()
    monkeypatch.setattr(target=main, name="close_engine", value=close)

    with TestClient(main.app):
        close.assert_not_called()

    close.assert_called_once()
    assert_log_contains(caplog, message="Shutdown complete")
