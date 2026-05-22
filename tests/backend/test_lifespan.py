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


def test_lifespan_closes_db_on_shutdown(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    close = MagicMock()
    monkeypatch.setattr(target=main, name="close_engine", value=close)

    with TestClient(main.app):
        close.assert_not_called()

    close.assert_called_once()


def test_lifespan_disposes_db_engine_after_background_tasks_are_cancelled(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    # Order matters: finish background tasks (which may hold sessions) first
    call_order: list[str] = []

    async def fake_rescan() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            call_order.append("rescan_cancelled")
            raise

    async def fake_sync() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            call_order.append("sync_cancelled")
            raise

    def fake_close() -> None:
        call_order.append("engine_closed")

    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=fake_rescan)
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=fake_sync)
    monkeypatch.setattr(target=main, name="close_engine", value=fake_close)

    with TestClient(main.app):
        pass

    assert "engine_closed" in call_order
    assert call_order.index("engine_closed") > call_order.index("rescan_cancelled")
    assert call_order.index("engine_closed") > call_order.index("sync_cancelled")
