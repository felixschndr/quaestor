import datetime
import inspect

import pytest
from source.backend.models.account import Account
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.user import User
from source.backend.services import statistics_service
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import (
    make_account,
    make_credential,
    make_transaction,
    make_user,
    seed_snapshot,
)


def _user_with_account(db_session: Session) -> tuple[User, Account]:
    user = make_user(db_session)
    credential = make_credential(db_session, user_id=user.id)
    account = make_account(db_session, credential_id=credential.id)
    return user, account


@pytest.mark.parametrize(
    argnames="function_name",
    argvalues=[
        "category_breakdown",
        "monthly_cashflow",
        "monthly_net_savings",
        "top_other_parties",
        "daily_net_worth",
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
        user, account = _user_with_account(session)
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
        user, account = _user_with_account(session)
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
        user, account = _user_with_account(session)
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
        user, account = _user_with_account(session)
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
        user, account = _user_with_account(session)
        session.commit()
        user_id, account_id = user.id, account.id
    # Balance at the end of `start` was 100; two booked transactions push it to 130 by `end`.
    seed_snapshot(session_factory, account_id=account_id, day=start, balance=100.0)
    seed_snapshot(session_factory, account_id=account_id, day=end, balance=130.0)
    with session_factory() as session:
        first = make_transaction(session, account_id=account_id, amount=50.0, date=end)
        second = make_transaction(session, account_id=account_id, amount=-20.0, date=end)
        make_transaction(session, account_id=account_id, amount=-999.0, date=end, pending=True)
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
        user, account = _user_with_account(session)
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
        user = make_user(session)
        credential = make_credential(session, user_id=user.id)
        account = make_account(session, credential_id=credential.id, balance=80.0)
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
