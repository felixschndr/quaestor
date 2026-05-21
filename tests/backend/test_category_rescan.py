import threading
from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from source.backend import main
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.services import category_rescan
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD_HASH,
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
        transaction = Transaction(
            account_id=account_id,
            amount=-1.0,
            purpose=purpose,
            other_party=other_party,
            date=date(year=2026, month=5, day=21),
            category=category,
        )
        session.add(transaction)
        session.commit()
        return transaction.id


def _persist_account(session_factory: sessionmaker) -> int:
    from source.backend.bank_handlers import BankProvider
    from source.backend.models.account import Account
    from source.backend.models.credential import Credential
    from source.backend.models.user import User

    with session_factory() as session:
        user = User(user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash=VALID_PASSWORD_HASH)
        credential = Credential(
            user=user,
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
            requires_two_factor_authentication=False,
        )
        account = Account(credential=credential, name="DE00", balance=0.0)
        session.add(user)
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
        other_party="Some Tiny Cafe",
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
        other_party="Some Tiny Cafe",
    )

    with caplog.at_level("INFO", logger="source.backend.services.category_rescan"):
        category_rescan.rescan_unknown_categories_sync()

    assert any(
        "Category re-scan: checked 2, updated 1, still unknown 1" in record.message for record in caplog.records
    ), [r.message for r in caplog.records]


def test_app_startup_schedules_category_rescan(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    scheduled = threading.Event()
    run_startup_rescan = AsyncMock(side_effect=lambda: scheduled.set())
    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=run_startup_rescan)

    with TestClient(main.app):
        assert scheduled.wait(timeout=5)

    run_startup_rescan.assert_called_once_with()
