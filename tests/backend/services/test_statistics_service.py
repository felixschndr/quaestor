import datetime
import inspect

import pytest
from sqlalchemy.orm import Session, sessionmaker

from source.backend.models.auth.user import User
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.services.transactions import statistics_service
from tests.backend.conftest import (
    LATEST_DATE,
    make_transaction,
    make_user,
    make_user_and_credential_and_account,
    seed_snapshot,
)


@pytest.mark.parametrize(
    argnames="function_name",
    argvalues=[
        "category_breakdown",
        "monthly_cashflow",
        "monthly_net_savings",
        "top_other_parties",
        "daily_net_worth",
        "transaction_counts",
    ],
)
def test_breakdown_returns_empty_without_selected_accounts(session_factory: sessionmaker, function_name: str):
    function = getattr(statistics_service, function_name)
    optional_kwargs = {
        "account_ids": [],
        "date_from": None,
        "date_to": None,
        "direction": "OUTGOING",
        "categories": [],
        "group_by": "day",
    }
    accepted_arguments = inspect.signature(function).parameters
    kwargs = {name: value for name, value in optional_kwargs.items() if name in accepted_arguments}

    with session_factory() as session:
        user = make_user(session)
        result = function(db_session=session, user=user, **kwargs)

    assert (result.series if hasattr(result, "series") else result) == []


def test_daily_net_worth_returns_empty_when_account_has_no_snapshots(session_factory: sessionmaker):
    # An owned account with no balance snapshots has no earliest date to anchor the
    # auto-start (date_from=None), so the series is empty.
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        result = statistics_service.daily_net_worth(
            db_session=session,
            user=user,
            account_ids=[account.id],
            date_from=None,
            date_to=None,
        )
    assert result.series == []


def test_daily_net_worth_anchors_to_earliest_snapshot_when_no_start_given(session_factory: sessionmaker):
    # With date_from=None the range auto-anchors to the earliest snapshot, so the series
    # spans from that snapshot up to today and is non-empty.
    snapshot_day = datetime.date.today() - datetime.timedelta(days=2)
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        account.balance = 123.0
        session.commit()
        user_id, account_id = user.id, account.id
    seed_snapshot(session_factory, account_id=account_id, day=snapshot_day, balance=123.0)

    with session_factory() as session:
        result = statistics_service.daily_net_worth(
            db_session=session,
            user=session.get(entity=User, ident=user_id),
            account_ids=[account_id],
            date_from=None,
            date_to=None,
        )

    assert result.series
    assert result.series[-1].value == 123.0


def test_daily_net_worth_uses_live_balance_for_todays_point(session_factory: sessionmaker):
    snapshot_day = datetime.date.today() - datetime.timedelta(days=2)
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        account.balance = 150.0
        session.commit()
        user_id, account_id = user.id, account.id
    seed_snapshot(session_factory, account_id=account_id, day=snapshot_day, balance=123.0)

    with session_factory() as session:
        result = statistics_service.daily_net_worth(
            db_session=session,
            user=session.get(entity=User, ident=user_id),
            account_ids=[account_id],
            date_from=None,
            date_to=None,
        )

    assert result.series[-1].date == datetime.date.today()
    assert result.series[-1].value == 150.0
    # Earlier points still reflect the snapshot, not the live balance.
    assert result.series[0].value == 123.0


def test_daily_net_worth_returns_empty_when_range_is_inverted(session_factory: sessionmaker):
    # date_from in the future while date_to defaults to today → end_date < date_from.
    future = datetime.date(year=2999, month=1, day=1)
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        result = statistics_service.daily_net_worth(
            db_session=session,
            user=user,
            account_ids=[account.id],
            date_from=future,
            date_to=None,
        )
    assert result.series == []


def test_net_worth_range_reports_before_after_and_transactions(session_factory: sessionmaker):
    end = datetime.date(year=2026, month=5, day=20)
    start = end - datetime.timedelta(days=1)
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        session.commit()
        user_id, account_id = user.id, account.id
    # Balance at the end of `start` was 100; two booked transactions push it to 130 by `end`.
    seed_snapshot(session_factory, account_id=account_id, day=start, balance=100.0)
    seed_snapshot(session_factory, account_id=account_id, day=end, balance=130.0)
    with session_factory() as session:
        first = make_transaction(session, account_id=account_id, amount=50.0, date=end)
        second = make_transaction(session, account_id=account_id, amount=-20.0, date=end)
        make_transaction(session, account_id=account_id, amount=-999.0, date=end, pending=True)
        make_transaction(session, account_id=account_id, amount=-888.0, date=end, expected=True)
        # A transaction on `start` itself is part of the "before" snapshot, not the range.
        make_transaction(session, account_id=account_id, amount=7.0, date=start)
        session.commit()
        first_id, second_id = first.id, second.id

    with session_factory() as session:
        result = statistics_service.get_net_worth_of_range(
            db_session=session,
            user=session.get(entity=User, ident=user_id),
            account_ids=[account_id],
            start=start,
            end=end,
        )

    def booked(transaction_id: int, amount: float) -> dict:
        return {
            "id": transaction_id,
            "account_id": account_id,
            "amount": amount,
            "purpose": None,
            "date": end,
            "other_party": None,
            "transaction_type": None,
            "category": TransactionCategory.UNKNOWN,
            "note": None,
            "transfer_counterpart_id": None,
            "pending": False,
            "contract_id": None,
        }

    assert result.model_dump() == {
        "start": start,
        "end": end,
        "total_at_start": 100.0,
        "total_at_end": 130.0,
        "total_difference": 30.0,
        "accounts": [
            {
                "account_id": account_id,
                "balance_at_start": 100.0,
                "balance_at_end": 130.0,
                "difference": 30.0,
                "transactions": [
                    booked(transaction_id=second_id, amount=-20.0),
                    booked(transaction_id=first_id, amount=50.0),
                ],
            }
        ],
    }


def test_net_worth_range_handles_account_without_prior_snapshot(session_factory: sessionmaker):
    # A market-valued account whose balance moved without any transaction
    end = datetime.date(year=2026, month=5, day=20)
    start = end - datetime.timedelta(days=1)
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        session.commit()
        user_id, account_id = user.id, account.id
    seed_snapshot(session_factory, account_id=account_id, day=end, balance=250.0)

    with session_factory() as session:
        result = statistics_service.get_net_worth_of_range(
            db_session=session,
            user=session.get(entity=User, ident=user_id),
            account_ids=[account_id],
            start=start,
            end=end,
        )

    change = result.accounts[0]
    assert change.balance_at_start is None
    assert change.balance_at_end == 250.0
    assert change.difference == 250.0
    assert change.transactions == []


def test_net_worth_range_uses_live_balance_for_today(session_factory: sessionmaker):
    today = datetime.date.today()
    start = today - datetime.timedelta(days=1)
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session, balance=80.0)
        session.commit()
        user_id, account_id = user.id, account.id

    with session_factory() as session:
        result = statistics_service.get_net_worth_of_range(
            db_session=session,
            user=session.get(entity=User, ident=user_id),
            account_ids=[account_id],
            start=start,
            end=today,
        )

    change = result.accounts[0]
    assert change.balance_at_end == 80.0
    assert result.total_at_end == 80.0


def _seed_count_transactions(session: Session, account_id: int) -> None:
    for offset_days in [0, 0, 6, 7, 30]:
        make_transaction(session, account_id=account_id, date=LATEST_DATE + datetime.timedelta(days=offset_days))
    make_transaction(session, account_id=account_id, date=LATEST_DATE, pending=True)
    make_transaction(session, account_id=account_id, date=LATEST_DATE, expected=True)


@pytest.mark.parametrize(
    argnames=("group_by", "expected"),
    argvalues=[
        ("day", [("2026-06-01", 2), ("2026-06-07", 1), ("2026-06-08", 1), ("2026-07-01", 1)]),
        ("week", [("2026-06-01", 3), ("2026-06-08", 1), ("2026-06-29", 1)]),
        ("month", [("2026-06", 4), ("2026-07", 1)]),
        ("weekday", [("0", 1), ("1", 3), ("3", 1)]),  # %w weekday numbers (Sunday = "0")
    ],
)
def test_transaction_counts_grouping(session_factory: sessionmaker, group_by: str, expected: list[tuple[str, int]]):
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        _seed_count_transactions(session, account_id=account.id)
        result = statistics_service.transaction_counts(
            db_session=session,
            user=user,
            account_ids=[account.id],
            date_from=None,
            date_to=None,
            categories=[],
            group_by=group_by,
        )

    assert [(bucket.bucket, bucket.count) for bucket in result] == expected


def test_transaction_counts_respects_date_range(session_factory: sessionmaker):
    with session_factory() as session:
        user, _, account = make_user_and_credential_and_account(session)
        _seed_count_transactions(session, account_id=account.id)
        result = statistics_service.transaction_counts(
            db_session=session,
            user=user,
            account_ids=[account.id],
            date_from=datetime.date(year=2026, month=6, day=8),
            date_to=datetime.date(year=2026, month=6, day=30),
            categories=[],
            group_by="day",
        )

    assert [(bucket.bucket, bucket.count) for bucket in result] == [("2026-06-08", 1)]
