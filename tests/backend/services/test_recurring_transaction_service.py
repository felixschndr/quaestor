from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import (
    PermissionDeniedError,
    RecurringTransactionNotFoundError,
)
from source.backend.models.accounts.account import Account
from source.backend.models.transactions.recurrence_frequency import RecurrenceFrequency
from source.backend.models.transactions.recurring_transaction import (
    RecurringTransaction,
)
from source.backend.models.transactions.transaction import Transaction
from source.backend.services.accounts import account_service
from source.backend.services.transactions import recurring_transaction_service
from tests.backend.conftest import (
    assert_log_contains,
    make_account_with_new_user,
    persist_manual_account_with_new_user,
)


def _d(iso: str) -> date:
    return date.fromisoformat(iso)


SATURDAY = _d("2026-06-06")  # a Saturday (weekday() == 5)


def _freeze_today(monkeypatch: pytest.MonkeyPatch, today_value: date) -> None:
    class _FixedDate(date):
        @classmethod
        def today(cls: type[date]) -> date:
            return today_value

    monkeypatch.setattr(target=recurring_transaction_service, name="date", value=_FixedDate)
    monkeypatch.setattr(target=account_service, name="date", value=_FixedDate)


# --- date math -------------------------------------------------------------


def test_next_monthly_returns_same_month_when_day_still_ahead():
    assert recurring_transaction_service.next_monthly(from_date=_d("2026-06-06"), day=15) == _d("2026-06-15")


def test_next_monthly_rolls_to_next_month_when_day_has_passed():
    assert recurring_transaction_service.next_monthly(from_date=_d("2026-06-20"), day=15) == _d("2026-07-15")


def test_next_monthly_includes_today_unless_after_is_set():
    assert recurring_transaction_service.next_monthly(from_date=_d("2026-06-06"), day=6) == _d("2026-06-06")
    assert recurring_transaction_service.next_monthly(from_date=_d("2026-06-06"), day=6, after=True) == _d("2026-07-06")


def test_next_monthly_clamps_to_last_day_of_short_month():
    # 2026 is not a leap year, so February has 28 days.
    assert recurring_transaction_service.next_monthly(from_date=_d("2026-01-31"), day=31, after=True) == _d(
        "2026-02-28"
    )
    assert recurring_transaction_service.next_monthly(from_date=_d("2026-02-01"), day=31) == _d("2026-02-28")


def test_next_weekly_includes_today_unless_after_is_set():
    assert recurring_transaction_service.next_weekly(from_date=SATURDAY, weekday=SATURDAY.weekday()) == SATURDAY
    assert recurring_transaction_service.next_weekly(from_date=SATURDAY, weekday=SATURDAY.weekday(), after=True) == _d(
        "2026-06-13"
    )


def test_next_weekly_advances_to_the_next_matching_weekday():
    # Two weekdays after Saturday is Monday.
    assert recurring_transaction_service.next_weekly(from_date=SATURDAY, weekday=(SATURDAY.weekday() + 2) % 7) == _d(
        "2026-06-08"
    )


# --- creating rules --------------------------------------------------------


def test_create_without_immediate_booking_schedules_only(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -50.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 28},
            book_immediately=False,
        )
        assert rule.next_run_date == _d("2026-06-28")
        assert account.balance == 100.0  # nothing booked yet
        assert account.transactions == []
        assert_log_contains(caplog, messages=["Created", "booked today:"])


def test_create_with_immediate_booking_books_today_and_schedules_next(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -50.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 6},
            book_immediately=True,
        )
        assert rule.next_run_date == _d("2026-07-06")  # strictly after today
        assert account.balance == 50.0
        assert len(account.transactions) == 1
        booked = account.transactions[0]
        assert booked.date == _d("2026-06-06")
        assert booked.recurring_transaction_id == rule.id


def test_create_rejects_non_manual_account(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    with session_factory() as session:
        account = make_account_with_new_user(session, bank=BankProvider.FINTS)
        session.commit()
        with pytest.raises(PermissionDeniedError):
            recurring_transaction_service.create_recurring_transaction(
                db_session=session,
                account=account,
                fields={"amount": 1.0, "frequency": RecurrenceFrequency.WEEKLY, "day_of_week": 0},
                book_immediately=False,
            )


# --- booking due occurrences ----------------------------------------------


def test_book_due_books_a_due_occurrence_and_advances_cursor(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -10.0, "frequency": RecurrenceFrequency.WEEKLY, "day_of_week": SATURDAY.weekday()},
            book_immediately=False,
        )
        # next_run_date is today (Saturday); nothing booked yet.

    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)
        assert_log_contains(caplog, message="due recurring transaction(s) across")

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 90.0
        assert len(account.transactions) == 1
        assert account.transactions[0].date == _d("2026-06-06")
        rule = session.scalars(select(RecurringTransaction)).one()
        assert rule.next_run_date == _d("2026-06-13")


def test_book_due_catches_up_multiple_missed_monthly_occurrences(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    account_id = persist_manual_account_with_new_user(session_factory, balance=1000.0)
    # Create the rule back in March, then jump "today" forward three months.
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-03-15"))
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -100.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 15},
            book_immediately=False,
        )
        # next_run_date == 2026-03-15

    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 700.0
        booked_dates = sorted(transaction.date for transaction in account.transactions)
        assert booked_dates == [_d("2026-03-15"), _d("2026-04-15"), _d("2026-05-15")]
        rule = session.scalars(select(RecurringTransaction)).one()
        assert rule.next_run_date == _d("2026-06-15")


def test_book_due_clamps_day_of_month_to_february(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    account_id = persist_manual_account_with_new_user(session_factory, balance=500.0)
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-01-31"))
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -20.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 31},
            book_immediately=True,  # books 2026-01-31, schedules 2026-02-28
        )

    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-02-28"))
    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        booked_dates = sorted(transaction.date for transaction in account.transactions)
        assert _d("2026-02-28") in booked_dates


def test_update_amount_only_keeps_the_next_run_date(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -50.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 28},
            book_immediately=False,
        )
        rule_id = rule.id  # next_run_date == 2026-06-28

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        updated = recurring_transaction_service.update_recurring_transaction(
            db_session=session,
            account=account,
            recurring_transaction_id=rule_id,
            fields={"amount": -75.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 28},
        )
        assert updated.amount == -75.0
        assert updated.next_run_date == _d("2026-06-28")  # unchanged


def test_update_schedule_recomputes_next_run_and_clears_other_day(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))  # a Saturday
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -50.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 28},
            book_immediately=False,
        )
        rule_id = rule.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        updated = recurring_transaction_service.update_recurring_transaction(
            db_session=session,
            account=account,
            recurring_transaction_id=rule_id,
            fields={"amount": -50.0, "frequency": RecurrenceFrequency.WEEKLY, "day_of_week": 0},  # Monday
        )
        assert updated.frequency == RecurrenceFrequency.WEEKLY
        assert updated.day_of_month is None
        assert updated.day_of_week == 0
        assert updated.next_run_date == _d("2026-06-08")  # next Monday on/after today


def test_update_unknown_rule_raises(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(RecurringTransactionNotFoundError):
            recurring_transaction_service.update_recurring_transaction(
                db_session=session,
                account=account,
                recurring_transaction_id=999999,
                fields={"amount": 1.0, "frequency": RecurrenceFrequency.WEEKLY, "day_of_week": 0},
            )
        assert_log_contains(caplog, message="Recurring transaction 999999 not found for")


def test_delete_detaches_booked_transactions_and_removes_rule(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -50.0, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": 6},
            book_immediately=True,
        )
        rule_id = rule.id
        booked_id = account.transactions[0].id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.delete_recurring_transaction(
            db_session=session, account=account, recurring_transaction_id=rule_id
        )
        assert_log_contains(caplog, message="Deleted recurring transaction")

    with session_factory() as session:
        assert session.get(entity=RecurringTransaction, ident=rule_id) is None
        booked = session.get(entity=Transaction, ident=booked_id)
        assert booked is not None  # the booked transaction survives
        assert booked.recurring_transaction_id is None  # but is detached from the deleted rule


def test_delete_unknown_rule_raises(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    _freeze_today(monkeypatch=monkeypatch, today_value=_d("2026-06-06"))
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(RecurringTransactionNotFoundError):
            recurring_transaction_service.delete_recurring_transaction(
                db_session=session, account=account, recurring_transaction_id=999999
            )
