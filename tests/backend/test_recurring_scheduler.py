import asyncio
import threading
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from source.backend import helpers, main
from source.backend.bank_handlers import BankProvider
from source.backend.models.account import Account
from source.backend.models.recurrence_frequency import RecurrenceFrequency
from source.backend.models.recurring_transaction import RecurringTransaction
from source.backend.services import recurring_transaction_scheduler
from source.backend.services.recurring_transaction_scheduler import (
    run_periodic_recurring as real_run_periodic_recurring,
)
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import make_account, make_credential, make_user


def test_sleeps_until_the_next_midnight(monkeypatch: pytest.MonkeyPatch):
    class _FixedDateTime(datetime):
        @classmethod
        def now(cls: type[datetime], tz: object = None) -> datetime:
            return datetime(year=2026, month=6, day=7, hour=23, minute=0, second=0)

    monkeypatch.setattr(target=helpers, name="datetime", value=_FixedDateTime)

    assert helpers.seconds_until_next_midnight() == 3600 + 5


def test_app_startup_schedules_periodic_recurring(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    scheduled = threading.Event()
    run_periodic_recurring = AsyncMock(side_effect=lambda: scheduled.set())
    monkeypatch.setattr(
        target=main.recurring_transaction_scheduler, name="run_periodic_recurring", value=run_periodic_recurring
    )

    with TestClient(main.app):
        assert scheduled.wait(timeout=5)

    run_periodic_recurring.assert_called_once_with()


def test_book_helper_uses_session_local(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=recurring_transaction_scheduler, name="SessionLocal", value=session_factory)
    called_with: list = []

    def book_mock(db_session: object) -> None:
        called_with.append(db_session)

    monkeypatch.setattr(
        target=recurring_transaction_scheduler.recurring_transaction_service,
        name="book_due_recurring_transactions",
        value=book_mock,
    )

    recurring_transaction_scheduler._book_due_recurring_transactions()

    assert len(called_with) == 1


def test_run_periodic_recurring_logs_and_keeps_running_on_exception(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    class _StopLoop(Exception):
        pass

    book_mock = Mock(side_effect=RuntimeError("booking failed"))
    monkeypatch.setattr(
        target=recurring_transaction_scheduler, name="_book_due_recurring_transactions", value=book_mock
    )

    async def fake_sleep(_seconds: float):  # noqa: ASYNC124
        raise _StopLoop

    monkeypatch.setattr(target=recurring_transaction_scheduler.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_recurring())

    error_messages = [r.message for r in caplog.records if r.levelname == "ERROR"]
    assert any("Recurring transaction booking run crashed" in msg for msg in error_messages), error_messages


def test_startup_run_books_rules_whose_day_passed_while_offline(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    yesterday = date.today() - timedelta(days=1)
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.MANUAL, credentials={})
        account = make_account(session, credential_id=credential.id, name="Wallet", balance=100.0)
        session.flush()
        session.add(
            RecurringTransaction(
                account=account,
                amount=-10.0,
                frequency=RecurrenceFrequency.MONTHLY,
                day_of_month=yesterday.day,
                next_run_date=yesterday,
                created_at=datetime.now(),
            )
        )
        session.commit()
        account_id = account.id

    monkeypatch.setattr(target=recurring_transaction_scheduler, name="SessionLocal", value=session_factory)

    class _StopLoop(Exception):
        pass

    async def fake_sleep(_seconds: float):  # noqa: ASYNC124
        raise _StopLoop

    monkeypatch.setattr(target=recurring_transaction_scheduler.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_recurring())

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert len(account.transactions) == 1
        assert account.transactions[0].date == yesterday  # booked with the scheduled date
        assert account.balance == 90.0


def test_run_periodic_recurring_calls_the_booking_function(monkeypatch: pytest.MonkeyPatch):
    class _StopLoop(Exception):
        pass

    book = Mock()
    monkeypatch.setattr(target=recurring_transaction_scheduler, name="_book_due_recurring_transactions", value=book)

    async def fake_sleep(_seconds: float):  # noqa: ASYNC124
        raise _StopLoop

    monkeypatch.setattr(target=recurring_transaction_scheduler.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_recurring())

    book.assert_called_once_with()
