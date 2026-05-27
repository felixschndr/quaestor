from datetime import date, timedelta

from source.backend.models.account import Account
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import (
    make_account,
    make_credential,
    make_transaction,
    make_user,
)


def _persist_account(session: Session, balance: float, transactions: list[tuple[date, float]]) -> Account:
    user = make_user(session)
    credential = make_credential(session, user_id=user.id)
    account = make_account(session, credential_id=credential.id, name="x", balance=balance)
    for day, amount in transactions:
        make_transaction(session, account_id=account.id, amount=amount, date=day)
    return account


def _get_persisted_snapshots(session: Session, account: Account) -> dict[date, float]:
    rows = session.scalars(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account.id)).all()
    return {row.date: row.balance for row in rows}


def test_account_repr_contains_identifying_fields():
    account = Account(id=42, credential_id=7, name="Checking", balance=123.45, balance_factor=80)

    assert repr(account) == (
        "<Account(id=42, credential_id=7, name=Checking, display_name=None, "
        "balance=123.45, balance_factor=80, is_hidden=None, group_id=None, position=None)>"
    )


def test_account_repr_includes_display_name_when_set():
    account = Account(id=1, credential_id=1, name="DE00", display_name="Mein Konto", balance=0.0, balance_factor=100)

    assert "display_name=Mein Konto" in repr(account)


def test_update_balance_at_date_persists_back_calculated_snapshots(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(
            session=session,
            balance=100.0,
            transactions=[
                (date(year=2025, month=3, day=5), 10.0),
                (date(year=2025, month=3, day=5), -5.0),
                (date(year=2025, month=3, day=3), 20.0),
                (date(year=2025, month=2, day=1), 50.0),
            ],
        )

        account.update_balance_at_date()
        session.flush()

        assert _get_persisted_snapshots(session=session, account=account) == {
            date(year=2025, month=3, day=5): 100.0,
            date(year=2025, month=3, day=3): 95.0,
            date(year=2025, month=2, day=1): 75.0,
        }


def test_update_balance_at_date_is_idempotent(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(
            session=session,
            balance=10.0,
            transactions=[(date(year=2025, month=1, day=1), 10.0)],
        )

        account.update_balance_at_date()
        session.flush()
        account.update_balance_at_date()
        session.flush()

        assert _get_persisted_snapshots(session=session, account=account) == {
            date(year=2025, month=1, day=1): 10.0,
        }


def test_update_balance_at_date_ignores_future_dated_transactions(session_factory: sessionmaker):
    with session_factory() as session:
        today = date.today()
        future = today + timedelta(days=7)
        yesterday = today - timedelta(days=1)
        account = _persist_account(
            session=session,
            balance=100.0,
            transactions=[
                (future, -50.0),
                (today, 5.0),
                (yesterday, -10.0),
            ],
        )

        account.update_balance_at_date()
        session.flush()

        snapshots = _get_persisted_snapshots(session=session, account=account)
        assert future not in snapshots
        assert snapshots[today] == 100
        assert snapshots[yesterday] == 100 - 5


def test_recompute_balance_at_date_overwrites_stale_snapshots(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(
            session=session,
            balance=100.0,
            transactions=[(date.today() - timedelta(days=1), -10.0)],
        )
        # Plant a wrong snapshot from a hypothetical earlier run.
        stale_day = date.today() - timedelta(days=1)
        account.balance_at_date[stale_day] = AccountBalanceSnapshot(date=stale_day, balance=999.0)
        session.flush()

        account.recompute_balances_at_date()
        session.flush()

        assert _get_persisted_snapshots(session=session, account=account)[stale_day] == 100


def test_update_balance_at_date_preserves_existing_snapshots_but_chains_correctly(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(
            session=session,
            balance=100.0,
            transactions=[
                (date(year=2025, month=3, day=5), 10.0),
                (date(year=2025, month=3, day=3), 20.0),
            ],
        )
        account.balance_at_date[date(year=2025, month=3, day=5)] = AccountBalanceSnapshot(
            date=date(year=2025, month=3, day=5), balance=999.0
        )
        session.flush()

        account.update_balance_at_date()
        session.flush()

        assert _get_persisted_snapshots(session=session, account=account) == {
            date(year=2025, month=3, day=5): 999.0,
            date(year=2025, month=3, day=3): 90.0,
        }
