import asyncio
import threading
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend import main
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.services.transactions import category_rescan
from source.backend.services.transactions.category_rescan import (
    run_startup_rescan as real_run_startup_rescan,
)
from tests.backend.conftest import (
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    assert_log_contains,
    persist_account_with_new_user,
    persist_transaction,
)


def test_rescan_updates_unknown_transactions_that_now_match(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=category_rescan, name="SessionLocal", value=session_factory)
    account_id = persist_account_with_new_user(session_factory)
    matchable_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party="REWE Markt",
    )

    category_rescan.rescan_unknown_categories_sync()

    with session_factory() as session:
        assert session.get(entity=Transaction, ident=matchable_id).category == TransactionCategory.SUPERMARKET


def test_rescan_leaves_truly_unknown_transactions_alone(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=category_rescan, name="SessionLocal", value=session_factory)
    account_id = persist_account_with_new_user(session_factory)
    transaction_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party=UNKNOWN_TRANSACTION_OTHER_PARTY,
    )

    category_rescan.rescan_unknown_categories_sync()

    with session_factory() as session:
        assert session.get(entity=Transaction, ident=transaction_id).category == TransactionCategory.UNKNOWN


def test_rescan_does_not_overwrite_non_unknown_transactions(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=category_rescan, name="SessionLocal", value=session_factory)
    account_id = persist_account_with_new_user(session_factory)
    manually_set_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.DRUGSTORE,
        other_party="REWE Markt",
    )

    category_rescan.rescan_unknown_categories_sync()

    with session_factory() as session:
        assert session.get(entity=Transaction, ident=manually_set_id).category == TransactionCategory.DRUGSTORE


def test_rescan_logs_summary_at_info(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=category_rescan, name="SessionLocal", value=session_factory)
    account_id = persist_account_with_new_user(session_factory)
    persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party="REWE Markt",
    )
    persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party=UNKNOWN_TRANSACTION_OTHER_PARTY,
    )

    category_rescan.rescan_unknown_categories_sync()

    assert_log_contains(
        caplog,
        messages=["Starting re-scan", "Re-scanned", "Category re-scan: checked 2, updated 1, still unknown 1"],
    )


def test_run_startup_rescan_logs_exception_instead_of_crashing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    def category_rescan_mock() -> None:
        raise RuntimeError("Something went wrong.")

    monkeypatch.setattr(target=category_rescan, name="rescan_unknown_categories_sync", value=category_rescan_mock)

    asyncio.run(real_run_startup_rescan())

    assert_log_contains(caplog, message="Startup category re-scan crashed")


def test_app_startup_schedules_category_rescan(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    scheduled = threading.Event()
    run_startup_rescan = AsyncMock(side_effect=lambda: scheduled.set())
    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=run_startup_rescan)

    with TestClient(main.app):
        assert scheduled.wait(timeout=5)

    run_startup_rescan.assert_called_once_with()
