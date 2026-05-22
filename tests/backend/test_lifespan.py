import asyncio
import threading
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from source.backend import main
from sqlalchemy.orm import sessionmaker


def test_lifespan_runs_alembic_upgrade_before_serving_requests(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    upgrade = MagicMock()
    monkeypatch.setattr(target=main.migrations, name="upgrade_to_head", value=upgrade)

    with TestClient(main.app):
        upgrade.assert_called_once_with()


def test_lifespan_cancels_all_background_tasks_on_shutdown(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)

    rescan_started = threading.Event()
    rescan_cancelled = threading.Event()
    sync_started = threading.Event()
    sync_cancelled = threading.Event()

    async def fake_rescan() -> None:
        rescan_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            rescan_cancelled.set()
            raise

    async def fake_sync() -> None:
        sync_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            sync_cancelled.set()
            raise

    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=fake_rescan)
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=fake_sync)

    with TestClient(main.app):
        assert rescan_started.wait(timeout=5)
        assert sync_started.wait(timeout=5)

    assert rescan_cancelled.wait(timeout=5), "rescan task was not cancelled on shutdown"
    assert sync_cancelled.wait(timeout=5), "sync task was not cancelled on shutdown"
