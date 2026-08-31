import asyncio
import threading
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend import helpers, main
from source.backend.bank_handlers import BankProvider
from source.backend.models.accounts.account import Account
from source.backend.models.transactions.recurrence_frequency import RecurrenceFrequency
from source.backend.models.transactions.recurring_transaction import RecurringTransaction
from source.backend.services.transactions import recurring_transaction_scheduler
from source.backend.services.transactions.recurring_transaction_scheduler import (
    run_periodic_recurring as real_run_periodic_recurring,
)
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    DEFAULT_BALANCE,
    WALLET_ACCOUNT_NAME,
    make_account,
    make_credential,
    make_user,
)


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


def test_startup_run_books_rules_whose_day_passed_while_offline(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    yesterday = date.today() - timedelta(days=1)
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.MANUAL, credentials={})
        account = make_account(session, credential_id=credential.id, name=WALLET_ACCOUNT_NAME, balance=DEFAULT_BALANCE)
        session.flush()
        session.add(
            RecurringTransaction(
                account=account,
                amount=-DEFAULT_AMOUNT,
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

    monkeypatch.setattr(target=helpers.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(real_run_periodic_recurring())

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert len(account.transactions) == 1
        assert account.transactions[0].date == yesterday  # booked with the scheduled date
        assert account.balance == DEFAULT_BALANCE - DEFAULT_AMOUNT
