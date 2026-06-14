import logging
from datetime import date, timedelta

import pytest
from source.backend.bank_handlers.base import BalanceObservation
from source.backend.models.account import Account
from source.backend.models.account_balance_snapshot import (
    AccountBalanceSnapshot,
    BalanceSnapshotSource,
)
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


def _plant_bank_anchor(account: Account, day: date, balance: float) -> None:
    account.balance_at_date[day] = AccountBalanceSnapshot(
        date=day, balance=balance, source=BalanceSnapshotSource.BANK_REPORTED
    )


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


def _plant_market_value(account: Account, day: date, balance: float) -> None:
    account.balance_at_date[day] = AccountBalanceSnapshot(
        date=day, balance=balance, source=BalanceSnapshotSource.MARKET_VALUED
    )


def test_recompute_leaves_market_valued_snapshots_untouched(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(
            session=session,
            balance=100.0,
            transactions=[(date(year=2025, month=3, day=5), 10.0)],
        )
        _plant_market_value(account=account, day=date(year=2025, month=3, day=5), balance=42.0)
        session.flush()

        assert account.is_market_valued
        account.recompute_balances_at_date()
        session.flush()

        assert _get_persisted_snapshots(session=session, account=account) == {date(year=2025, month=3, day=5): 42.0}


def test_record_market_value_history_replaces_previous_market_snapshots(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(session=session, balance=0.0, transactions=[])
        _plant_market_value(account=account, day=date(year=2025, month=1, day=1), balance=10.0)
        session.flush()

        account.record_market_value_history(
            [
                BalanceObservation(date=date(year=2025, month=2, day=1), amount=20.0),
                BalanceObservation(date=date(year=2025, month=2, day=2), amount=25.0),
            ]
        )
        session.flush()

        snapshots = _get_persisted_snapshots(session=session, account=account)
        assert snapshots == {date(year=2025, month=2, day=1): 20.0, date(year=2025, month=2, day=2): 25.0}
        assert all(
            snapshot.source == BalanceSnapshotSource.MARKET_VALUED for snapshot in account.balance_at_date.values()
        )


def test_record_market_value_history_ignores_future_dates(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(session=session, balance=0.0, transactions=[])
        future = date.today() + timedelta(days=3)

        account.record_market_value_history([BalanceObservation(date=future, amount=99.0)])
        session.flush()

        assert future not in account.balance_at_date


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


def test_record_balance_observations_persists_bank_reported_anchor(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(session=session, balance=0.0, transactions=[])
        anchor_day = date.today() - timedelta(days=10)

        account.record_balance_observations([BalanceObservation(date=anchor_day, amount=625.15)])
        session.flush()

        snapshot = account.balance_at_date[anchor_day]
        assert snapshot.balance == 625.15
        assert snapshot.source == BalanceSnapshotSource.BANK_REPORTED


def test_record_balance_observations_ignores_future_dates(session_factory: sessionmaker):
    with session_factory() as session:
        account = _persist_account(session=session, balance=0.0, transactions=[])
        future = date.today() + timedelta(days=3)

        account.record_balance_observations([BalanceObservation(date=future, amount=10.0)])
        session.flush()

        assert future not in account.balance_at_date


def test_record_balance_observations_upgrades_existing_computed_snapshot(session_factory: sessionmaker):
    with session_factory() as session:
        day = date.today() - timedelta(days=2)
        account = _persist_account(session=session, balance=100.0, transactions=[(day, 5.0)])
        account.update_balance_at_date()  # creates a COMPUTED snapshot for `day`
        session.flush()
        assert account.balance_at_date[day].source == BalanceSnapshotSource.COMPUTED

        account.record_balance_observations([BalanceObservation(date=day, amount=88.0)])
        session.flush()

        snapshot = account.balance_at_date[day]
        assert snapshot.balance == 88.0
        assert snapshot.source == BalanceSnapshotSource.BANK_REPORTED


def test_drift_warns_for_actionable_anchors_but_stays_quiet_at_fetch_horizon(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as session:
        today = date.today()
        d1, d2, d3, d4 = (today - timedelta(days=n) for n in (1, 2, 3, 4))
        account = _persist_account(session=session, balance=100.0, transactions=[(d1, 10.0), (d3, 5.0)])
        _plant_bank_anchor(account=account, day=d2, balance=80.0)
        _plant_bank_anchor(account=account, day=d4, balance=60.0)
        session.flush()

        with caplog.at_level(logging.DEBUG):
            account.recompute_balances_at_date()
            session.flush()

        warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "drift" in r.message.lower()]
        debugs = [r for r in caplog.records if r.levelno == logging.DEBUG and "drift" in r.message.lower()]
        assert len(warnings) == 1 and str(d2) in warnings[0].message
        assert len(debugs) == 1 and str(d4) in debugs[0].message


def test_bank_anchor_day_with_own_transaction_does_not_double_count(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as session:
        today = date.today()
        d1, d2, d3 = today - timedelta(days=1), today - timedelta(days=2), today - timedelta(days=3)
        # Bank reported 50 at d2 *before* the +200 salary that posts on d2. Current balance 260
        # decomposes as: 50 (anchor, start of d2) + 200 (d2 salary) + 10 (d1) = 260.
        account = _persist_account(session=session, balance=260.0, transactions=[(d1, 10.0), (d2, 200.0)])
        _plant_bank_anchor(account=account, day=d2, balance=50.0)
        session.flush()

        with caplog.at_level(logging.WARNING):
            account.recompute_balances_at_date()
            session.flush()

        # No drift: the anchor reconciles exactly once the same-day booking is not double-counted.
        assert not any("drift" in record.message.lower() for record in caplog.records)
        snapshots = _get_persisted_snapshots(session=session, account=account)
        assert snapshots[d1] == 260.0  # end of d1, after the d2 salary already happened
        # d2 is within the transaction range, so its snapshot is the transaction-driven END-of-day value
        # (50 start + 200 salary = 250); the day's bookings are thus attributed to d2, not leaked onto d1.
        assert snapshots[d2] == 250.0
        assert account.balance_at_date[d2].source == BalanceSnapshotSource.COMPUTED
        assert d3 not in snapshots  # no transaction and no anchor before d2 -> walk stops


def test_backdated_transaction_missing_from_anchor_does_not_leak_across_seam(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    # Regression for the phantom-jump bug: a back-dated transfer (+150 on d5) is in today's real
    # balance but the bank's daily anchors for d4/d5 never saw it. The old algorithm reset the walk to
    # those stale anchors, so the 150 leaked across the bank->computed seam and surfaced as a phantom
    # jump on the first computed day (d3). With the fix, the in-range anchors are validated-only and the
    # series stays transaction-driven, so each day's delta equals its own bookings.
    with session_factory() as session:
        today = date.today()
        d3, d4, d5 = (today - timedelta(days=n) for n in (3, 4, 5))
        # End-of-d5 = 1000 (anchor start) + 150 = 1150; d4 unchanged; d3 -36.90 -> 1113.10 = today's balance.
        account = _persist_account(session=session, balance=1113.10, transactions=[(d5, 150.0), (d3, -36.90)])
        _plant_bank_anchor(account=account, day=d5, balance=1000.0)
        _plant_bank_anchor(account=account, day=d4, balance=1000.0)  # bank never saw the +150
        session.flush()

        with caplog.at_level(logging.WARNING):
            account.recompute_balances_at_date()
            session.flush()

        snapshots = _get_persisted_snapshots(session=session, account=account)
        assert snapshots[d5] == 1150.0  # +150 attributed to its real day
        assert snapshots[d4] == 1150.0  # no bookings on d4 -> no change
        assert snapshots[d3] == 1113.10  # d4 -> d3 delta is exactly the -36.90 booking, no phantom +150
        # The stale d4 anchor (1000 vs walk 1150) is flagged, not silently absorbed.
        assert any("drift" in record.message.lower() for record in caplog.records)


def test_bank_anchor_within_tolerance_does_not_warn(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    with session_factory() as session:
        today = date.today()
        d1, d2 = today - timedelta(days=1), today - timedelta(days=2)
        # Backward walk derives exactly 100 at d2, matching the anchor --> no drift.
        account = _persist_account(session=session, balance=110.0, transactions=[(d1, 10.0)])
        _plant_bank_anchor(account=account, day=d2, balance=100.0)
        session.flush()

        with caplog.at_level(logging.WARNING):
            account.recompute_balances_at_date()
            session.flush()

        assert not any("drift" in record.message.lower() for record in caplog.records)


def test_recompute_preserves_bank_reported_anchor_but_rebuilds_computed(session_factory: sessionmaker):
    with session_factory() as session:
        day = date.today() - timedelta(days=1)
        account = _persist_account(session=session, balance=100.0, transactions=[(day, -10.0)])
        anchor_day = date.today() - timedelta(days=5)
        _plant_bank_anchor(account=account, day=anchor_day, balance=42.0)
        # A stale computed snapshot that must be rebuilt.
        account.balance_at_date[day] = AccountBalanceSnapshot(date=day, balance=999.0)
        session.flush()

        account.recompute_balances_at_date()
        session.flush()

        snapshots = _get_persisted_snapshots(session=session, account=account)
        assert snapshots[anchor_day] == 42.0  # anchor survived
        assert snapshots[day] == 100.0  # computed rebuilt from scratch
        assert account.balance_at_date[anchor_day].source == BalanceSnapshotSource.BANK_REPORTED
