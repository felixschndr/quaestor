from datetime import date, timedelta

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
from source.backend.models.transactions.recurring_transaction import RecurringTransaction
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.services.accounts import account_service
from source.backend.services.transactions import recurring_transaction_service
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    DEFAULT_BALANCE,
    LARGE_AMOUNT,
    LATEST_DATE,
    MONTH_END_DATE,
    OLDER_DATE,
    RECENT_DATE,
    SECOND_AMOUNT,
    SHORT_MONTH_END_DATE,
    UNKNOWN_ID,
    assert_log_contains,
    make_account_with_new_user,
    persist_manual_account_with_new_user,
)

TODAY = LATEST_DATE
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)
NEXT_WEEK = TODAY + timedelta(weeks=1)
NEXT_MONTH = TODAY.replace(month=TODAY.month + 1)
LATER_THIS_MONTH = TODAY.replace(day=RECENT_DATE.day)


def _freeze_today(monkeypatch: pytest.MonkeyPatch, today_value: date) -> None:
    class _FixedDate(date):
        @classmethod
        def today(cls: type[date]) -> date:
            return today_value

    monkeypatch.setattr(target=recurring_transaction_service, name="date", value=_FixedDate)
    monkeypatch.setattr(target=account_service, name="date", value=_FixedDate)


# --- date math -------------------------------------------------------------


@pytest.mark.parametrize(
    argnames=("from_date", "day", "after", "expected"),
    argvalues=[
        (TODAY, LATER_THIS_MONTH.day, False, LATER_THIS_MONTH),  # same month when day still ahead
        (OLDER_DATE, RECENT_DATE.day, False, RECENT_DATE),  # rolls to next month when day has passed
        (TODAY, TODAY.day, False, TODAY),  # includes today unless after is set
        (TODAY, TODAY.day, True, NEXT_MONTH),  # after skips today
        (MONTH_END_DATE, MONTH_END_DATE.day, True, SHORT_MONTH_END_DATE),  # clamps to last day of short month
        (SHORT_MONTH_END_DATE.replace(day=1), MONTH_END_DATE.day, False, SHORT_MONTH_END_DATE),
    ],
)
def test_next_monthly(from_date: date, day: int, after: bool, expected: date):
    assert recurring_transaction_service.next_monthly(from_date=from_date, day=day, after=after) == expected


@pytest.mark.parametrize(
    argnames=("from_date", "weekday", "after", "expected"),
    argvalues=[
        (TODAY, TODAY.weekday(), False, TODAY),  # includes today unless after is set
        (TODAY, TODAY.weekday(), True, NEXT_WEEK),  # after skips today
        (TODAY, TOMORROW.weekday(), False, TOMORROW),
        (TODAY, YESTERDAY.weekday(), False, YESTERDAY + timedelta(weeks=1)),  # wraps into the next week
    ],
)
def test_next_weekly(from_date: date, weekday: int, after: bool, expected: date):
    assert recurring_transaction_service.next_weekly(from_date=from_date, weekday=weekday, after=after) == expected


# --- creating rules --------------------------------------------------------


def test_create_without_immediate_booking_schedules_only(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={
                "amount": -DEFAULT_AMOUNT,
                "frequency": RecurrenceFrequency.MONTHLY,
                "day_of_month": LATER_THIS_MONTH.day,
            },
            book_immediately=False,
        )
        assert rule.next_run_date == LATER_THIS_MONTH
        assert account.balance == DEFAULT_BALANCE  # nothing booked yet
        assert account.transactions == []
        assert_log_contains(caplog, message=f"Created <RecurringTransaction(id={rule.id}")
        assert_log_contains(caplog, message=f")>; next run {LATER_THIS_MONTH} (booked today: False)")


def test_create_with_immediate_booking_books_today_and_schedules_next(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -DEFAULT_AMOUNT, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": TODAY.day},
            book_immediately=True,
        )
        assert rule.next_run_date == NEXT_MONTH  # strictly after today
        assert account.balance == DEFAULT_BALANCE - DEFAULT_AMOUNT
        assert len(account.transactions) == 1
        booked = account.transactions[0]
        assert booked.date == TODAY
        assert booked.recurring_transaction_id == rule.id


def test_booked_occurrence_takes_the_category_of_its_rule(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={
                "amount": -DEFAULT_AMOUNT,
                "category": TransactionCategory.STREAMING,
                "frequency": RecurrenceFrequency.WEEKLY,
                "day_of_week": TODAY.weekday(),
            },
            book_immediately=True,
        )

        (booked,) = account.transactions
        assert booked.category == TransactionCategory.STREAMING


def test_book_due_with_nothing_due_books_nothing(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)

    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)

    with session_factory() as session:
        assert session.get(entity=Account, ident=account_id).transactions == []
    assert_log_contains(caplog, message="due recurring transaction(s)", negate=True)


def test_create_rejects_non_manual_account(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    with session_factory() as session:
        account = make_account_with_new_user(session, bank=BankProvider.FINTS)
        session.commit()
        with pytest.raises(PermissionDeniedError):
            recurring_transaction_service.create_recurring_transaction(
                db_session=session,
                account=account,
                fields={
                    "amount": -DEFAULT_AMOUNT,
                    "frequency": RecurrenceFrequency.WEEKLY,
                    "day_of_week": TODAY.weekday(),
                },
                book_immediately=False,
            )


# --- booking due occurrences ----------------------------------------------


def test_book_due_books_a_due_occurrence_and_advances_cursor(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -DEFAULT_AMOUNT, "frequency": RecurrenceFrequency.WEEKLY, "day_of_week": TODAY.weekday()},
            book_immediately=False,
        )
        # next_run_date is today; nothing booked yet.

    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)
        assert_log_contains(caplog, message="Booked 1 due recurring transaction(s) across 1 rule(s)")

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == DEFAULT_BALANCE - DEFAULT_AMOUNT
        assert len(account.transactions) == 1
        assert account.transactions[0].date == TODAY
        rule = session.scalars(select(RecurringTransaction)).one()
        assert rule.next_run_date == NEXT_WEEK


def test_book_due_catches_up_multiple_missed_monthly_occurrences(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    account_id = persist_manual_account_with_new_user(session_factory, balance=LARGE_AMOUNT)
    # Create the rule months ago, then jump "today" forward.
    _freeze_today(monkeypatch=monkeypatch, today_value=OLDER_DATE)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={
                "amount": -DEFAULT_AMOUNT,
                "frequency": RecurrenceFrequency.MONTHLY,
                "day_of_month": OLDER_DATE.day,
            },
            book_immediately=False,
        )

    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)

    missed_dates = [OLDER_DATE.replace(month=month) for month in range(OLDER_DATE.month, TODAY.month)]
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == LARGE_AMOUNT - len(missed_dates) * DEFAULT_AMOUNT
        booked_dates = sorted(transaction.date for transaction in account.transactions)
        assert booked_dates == missed_dates
        rule = session.scalars(select(RecurringTransaction)).one()
        assert rule.next_run_date == OLDER_DATE.replace(month=TODAY.month)


def test_daily_rule_books_today_and_catches_up_every_missed_day(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    account_id = persist_manual_account_with_new_user(session_factory, balance=LARGE_AMOUNT)
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -DEFAULT_AMOUNT, "frequency": RecurrenceFrequency.DAILY},
            book_immediately=True,
        )
        assert rule.next_run_date == TOMORROW

    _freeze_today(monkeypatch=monkeypatch, today_value=NEXT_WEEK)
    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)

    every_day = [TODAY + timedelta(days=offset) for offset in range((NEXT_WEEK - TODAY).days + 1)]
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == LARGE_AMOUNT - len(every_day) * DEFAULT_AMOUNT
        booked_dates = sorted(transaction.date for transaction in account.transactions)
        assert booked_dates == every_day
        assert session.scalars(select(RecurringTransaction)).one().next_run_date == NEXT_WEEK + timedelta(days=1)


def test_book_due_clamps_day_of_month_to_february(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    account_id = persist_manual_account_with_new_user(session_factory)
    _freeze_today(monkeypatch=monkeypatch, today_value=MONTH_END_DATE)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={
                "amount": -DEFAULT_AMOUNT,
                "frequency": RecurrenceFrequency.MONTHLY,
                "day_of_month": MONTH_END_DATE.day,
            },
            book_immediately=True,  # books the month end, schedules the end of the short month
        )

    _freeze_today(monkeypatch=monkeypatch, today_value=SHORT_MONTH_END_DATE)
    with session_factory() as session:
        recurring_transaction_service.book_due_recurring_transactions(session)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        booked_dates = sorted(transaction.date for transaction in account.transactions)
        assert SHORT_MONTH_END_DATE in booked_dates


def test_update_amount_only_keeps_the_next_run_date(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)
    schedule = {"frequency": RecurrenceFrequency.MONTHLY, "day_of_month": LATER_THIS_MONTH.day}
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -DEFAULT_AMOUNT, **schedule},
            book_immediately=False,
        )
        rule_id = rule.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        updated = recurring_transaction_service.update_recurring_transaction(
            db_session=session,
            account=account,
            recurring_transaction_id=rule_id,
            fields={"amount": -SECOND_AMOUNT, **schedule},
        )
        assert updated.amount == -SECOND_AMOUNT
        assert updated.next_run_date == LATER_THIS_MONTH  # unchanged
        assert_log_contains(
            caplog, message=f"Updated Recurringtransaction: amount: {-DEFAULT_AMOUNT} → {-SECOND_AMOUNT} ("
        )


def test_update_schedule_recomputes_next_run_and_clears_other_day(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={
                "amount": -DEFAULT_AMOUNT,
                "frequency": RecurrenceFrequency.MONTHLY,
                "day_of_month": LATER_THIS_MONTH.day,
            },
            book_immediately=False,
        )
        rule_id = rule.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        updated = recurring_transaction_service.update_recurring_transaction(
            db_session=session,
            account=account,
            recurring_transaction_id=rule_id,
            fields={
                "amount": -DEFAULT_AMOUNT,
                "frequency": RecurrenceFrequency.WEEKLY,
                "day_of_week": TOMORROW.weekday(),
            },
        )
        assert updated.frequency == RecurrenceFrequency.WEEKLY
        assert updated.day_of_month is None
        assert updated.day_of_week == TOMORROW.weekday()
        assert updated.next_run_date == TOMORROW  # next matching weekday on/after today
        assert_log_contains(
            caplog,
            message=(
                f"Updated Recurringtransaction: frequency: MONTHLY → WEEKLY, day_of_month: {LATER_THIS_MONTH.day} → "
                f"None, day_of_week: None → {TOMORROW.weekday()}, next_run_date: {LATER_THIS_MONTH} → {TOMORROW} ("
            ),
        )


def test_update_unknown_rule_raises(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(RecurringTransactionNotFoundError):
            recurring_transaction_service.update_recurring_transaction(
                db_session=session,
                account=account,
                recurring_transaction_id=UNKNOWN_ID,
                fields={
                    "amount": -DEFAULT_AMOUNT,
                    "frequency": RecurrenceFrequency.WEEKLY,
                    "day_of_week": TODAY.weekday(),
                },
            )
        assert_log_contains(
            caplog, message=f"Recurring transaction {UNKNOWN_ID} not found for <Account(id={account_id}"
        )


def test_delete_detaches_booked_transactions_and_removes_rule(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        rule = recurring_transaction_service.create_recurring_transaction(
            db_session=session,
            account=account,
            fields={"amount": -DEFAULT_AMOUNT, "frequency": RecurrenceFrequency.MONTHLY, "day_of_month": TODAY.day},
            book_immediately=True,
        )
        rule_id = rule.id
        booked_id = account.transactions[0].id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        recurring_transaction_service.delete_recurring_transaction(
            db_session=session, account=account, recurring_transaction_id=rule_id
        )
        assert_log_contains(caplog, message=f"Deleted recurring transaction {rule_id} from <Account(id={account_id}")

    with session_factory() as session:
        assert session.get(entity=RecurringTransaction, ident=rule_id) is None
        booked = session.get(entity=Transaction, ident=booked_id)
        assert booked is not None  # the booked transaction survives
        assert booked.recurring_transaction_id is None  # but is detached from the deleted rule


def test_delete_unknown_rule_raises(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    _freeze_today(monkeypatch=monkeypatch, today_value=TODAY)
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(RecurringTransactionNotFoundError):
            recurring_transaction_service.delete_recurring_transaction(
                db_session=session, account=account, recurring_transaction_id=UNKNOWN_ID
            )
