import asyncio
import logging
import threading
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from source.backend import main
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.services import category_rescan
from source.backend.services.category_rescan import (
    run_startup_rescan as real_run_startup_rescan,
)
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)


def _persist_transaction(
    *,
    session_factory: sessionmaker,
    account_id: int,
    category: TransactionCategory,
    other_party: str | None,
    purpose: str | None = None,
) -> int:
    with session_factory() as session:
        transaction = make_transaction(
            session,
            account_id=account_id,
            other_party=other_party,
            purpose=purpose,
            category=category,
        )
        session.commit()
        return transaction.id


def _persist_account(session_factory: sessionmaker) -> int:
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id)
        account = make_account(session, credential_id=credential.id, name="DE00")
        session.commit()
        return account.id


def test_rescan_updates_unknown_transactions_that_now_match(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=category_rescan, name="SessionLocal", value=session_factory)
    account_id = _persist_account(session_factory=session_factory)
    matchable_id = _persist_transaction(
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
    account_id = _persist_account(session_factory=session_factory)
    transaction_id = _persist_transaction(
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
    account_id = _persist_account(session_factory=session_factory)
    manually_set_id = _persist_transaction(
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
    account_id = _persist_account(session_factory=session_factory)
    _persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party="REWE Markt",
    )
    _persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party=UNKNOWN_TRANSACTION_OTHER_PARTY,
    )

    with caplog.at_level("INFO", logger="source.backend.services.category_rescan"):
        category_rescan.rescan_unknown_categories_sync()

    assert any(
        "Category re-scan: checked 2, updated 1, still unknown 1" in record.message for record in caplog.records
    ), [r.message for r in caplog.records]


def test_run_startup_rescan_logs_exception_instead_of_crashing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    def category_rescan_mock() -> None:
        raise RuntimeError("Something went wrong.")

    monkeypatch.setattr(target=category_rescan, name="rescan_unknown_categories_sync", value=category_rescan_mock)

    # propagate=True isn't enough for caplog to pick up records from the worker
    # thread spawned by asyncio.to_thread --> install a direct handler on the
    # source logger instead.
    captured: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    handler = _Capture(level=logging.ERROR)
    logging.getLogger("source.backend.services.category_rescan").addHandler(handler)
    try:
        asyncio.run(real_run_startup_rescan())
    finally:
        logging.getLogger("source.backend.services.category_rescan").removeHandler(handler)

    assert any(
        "Startup category re-scan crashed" in record.getMessage() and record.exc_info is not None for record in captured
    ), [record.getMessage() for record in captured]
    assert (
        caplog is not None
    )  # caplog is referenced to keep pytest's fixture happy even though we handled capture ourselves.


def test_app_startup_schedules_category_rescan(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    scheduled = threading.Event()
    run_startup_rescan = AsyncMock(side_effect=lambda: scheduled.set())
    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=run_startup_rescan)

    with TestClient(main.app):
        assert scheduled.wait(timeout=5)

    run_startup_rescan.assert_called_once_with()
