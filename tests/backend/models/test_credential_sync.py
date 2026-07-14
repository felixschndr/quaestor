from datetime import date, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import sessionmaker

from source.backend.bank_handlers.base import (
    BalanceObservation,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.models.accounts.account_balance_snapshot import (
    BalanceSnapshotSource,
)
from source.backend.models.banking.credential import Credential
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    LAST_FETCHING_TIMESTAMP,
    OLDER_DATE,
    RECENT_DATE,
    SECOND_ACCOUNT_IBAN,
    FakeBankSession,
    assert_log_contains,
    build_handler,
    make_account,
    make_credential,
    make_transaction,
    make_user,
    persist_credential_with_new_user,
    seed_account_with_expectation,
    sync_with_booked,
)


def test_sync_creates_new_account_with_balance_and_transactions(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    credential_id = persist_credential_with_new_user(session_factory)
    fake_account = FetchedAccount(name=ACCOUNT_IBAN)
    transactions = [
        FetchedTransaction(
            amount=-12.34,
            purpose="Coffee",
            date=RECENT_DATE,
            other_party="Café",
            transaction_type=TransactionType.OUTGOING,
        ),
        FetchedTransaction(
            amount=2500.0,
            purpose="Salary",
            date=date(year=2026, month=5, day=1),
            other_party="ACME Corp",
            transaction_type=TransactionType.INCOMING,
        ),
    ]
    handler = build_handler(
        FakeBankSession(
            accounts=[fake_account],
            balances={ACCOUNT_IBAN: 1000.0},
            transactions={ACCOUNT_IBAN: transactions},
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    assert_log_contains(caplog, messages=["account(s) created", "transaction(s) created"])

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        assert len(credential.accounts) == 1
        account = credential.accounts[0]
        assert account.name == ACCOUNT_IBAN
        assert account.balance == 1000.0
        assert {tx.amount for tx in account.transactions} == {-12.34, 2500.0}
        expected_days = {RECENT_DATE, date(year=2026, month=5, day=1)}
        assert expected_days <= set(account.balance_at_date.keys())
        assert credential.last_fetching_timestamp is not None


def test_sync_matches_existing_account_by_name_and_adds_missing_ones(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    with session_factory() as session:
        make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        session.commit()

    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN), FetchedAccount(name=SECOND_ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 50.0, SECOND_ACCOUNT_IBAN: 0.0},
            transactions={},
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        names_to_balance = {account.name: account.balance for account in credential.accounts}
        assert names_to_balance == {ACCOUNT_IBAN: 50.0, SECOND_ACCOUNT_IBAN: 0.0}


def test_sync_does_not_duplicate_already_existing_transactions(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    existing_tx = FetchedTransaction(
        amount=-9.99,
        purpose="Recurring",
        date=date(year=2026, month=5, day=10),
        other_party="ACME",
        transaction_type=TransactionType.OUTGOING,
    )

    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 0.0},
            transactions={ACCOUNT_IBAN: [existing_tx]},
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()
        credential.sync(handler)  # second sync — same fetched transactions
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        assert len(credential.accounts[0].transactions) == 1


def _create_fetched_transaction(amount: float, day: int, pending: bool) -> FetchedTransaction:
    return FetchedTransaction(
        amount=amount,
        purpose="booked" if not pending else "vorgemerkt",
        date=date(year=2026, month=5, day=day),
        other_party="ACME",
        transaction_type=TransactionType.OUTGOING,
        pending=pending,
    )


def _booked_transaction(amount: float, day: int) -> FetchedTransaction:
    return _create_fetched_transaction(amount=amount, day=day, pending=False)


def _pending_transaction(amount: float, day: int) -> FetchedTransaction:
    return _create_fetched_transaction(amount=amount, day=day, pending=True)


def test_sync_stores_pending_flag(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 0.0},
            transactions={
                ACCOUNT_IBAN: [_booked_transaction(amount=-10.0, day=10), _pending_transaction(amount=-20.0, day=11)]
            },
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        assert {tx.amount: tx.pending for tx in credential.accounts[0].transactions} == {-10.0: False, -20.0: True}


def test_sync_rebuilds_pending_each_time_without_accumulating(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    bank = FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={
            ACCOUNT_IBAN: [_booked_transaction(amount=-10.0, day=10), _pending_transaction(amount=-20.0, day=11)]
        },
    )
    handler = build_handler(bank)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

        # Next sync: the pending entry has drifted (new date) --> the stale one must be wiped, not kept
        bank._transactions[ACCOUNT_IBAN] = [
            _booked_transaction(amount=-10.0, day=10),
            _pending_transaction(amount=-20.0, day=13),
        ]
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        transactions = credential.accounts[0].transactions
        assert len(transactions) == 2
        pending = [tx for tx in transactions if tx.pending]
        assert len(pending) == 1
        assert pending[0].date == date(year=2026, month=5, day=13)


def test_pending_that_becomes_booked_is_not_duplicated(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    bank = FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={ACCOUNT_IBAN: [_pending_transaction(amount=-142.0, day=4)]},
    )
    handler = build_handler(bank)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

        bank._transactions[ACCOUNT_IBAN] = [_booked_transaction(amount=-142.0, day=2)]
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        transactions = credential.accounts[0].transactions
        assert len(transactions) == 1
        assert transactions[0].pending is False
        assert transactions[0].purpose == "booked"


def test_pending_transactions_are_excluded_from_balance_history(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 0.0},
            transactions={
                ACCOUNT_IBAN: [_booked_transaction(amount=-10.0, day=10), _pending_transaction(amount=-20.0, day=12)]
            },
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        balance_days = set(credential.accounts[0].balance_at_date.keys())
        assert date(year=2026, month=5, day=10) in balance_days
        assert date(year=2026, month=5, day=12) not in balance_days


def test_sync_keeps_expected_transactions_while_wiping_bank_pending(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        make_transaction(session, account_id=account.id, amount=-500.0, date=OLDER_DATE, pending=True, expected=True)
        make_transaction(session, account_id=account.id, amount=-7.0, date=OLDER_DATE, pending=True)
        session.commit()

    sync_with_booked(session_factory=session_factory, credential_id=credential_id, booked=[])

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 1
        assert transactions[0].expected is True
        assert transactions[0].amount == -500.0


def test_sync_resolves_expected_within_tolerance_and_moves_note(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    credential_id = persist_credential_with_new_user(session_factory)
    seed_account_with_expectation(
        session_factory=session_factory, credential_id=credential_id, amount=-100.0, tolerance=10
    )

    sync_with_booked(
        session_factory=session_factory,
        credential_id=credential_id,
        booked=[_booked_transaction(amount=-105.0, day=5)],
    )

    assert_log_contains(caplog, messages=["Resolved", "expected transaction(s) on"])

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 1
        booking = transactions[0]
        assert booking.expected is False
        assert booking.pending is False
        assert booking.amount == -105.0
        assert booking.note == "expected note"


def test_sync_keeps_expected_when_amount_outside_tolerance(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    seed_account_with_expectation(
        session_factory=session_factory, credential_id=credential_id, amount=-100.0, tolerance=10
    )

    sync_with_booked(
        session_factory=session_factory, credential_id=credential_id, booked=[_booked_transaction(amount=-120.0, day=5)]
    )

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert {tx.expected for tx in transactions} == {True, False}
        assert len(transactions) == 2  # expectation kept, booking added separately


def test_sync_does_not_match_expected_with_opposite_sign(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    seed_account_with_expectation(
        session_factory=session_factory, credential_id=credential_id, amount=100.0, tolerance=20
    )

    sync_with_booked(
        session_factory=session_factory, credential_id=credential_id, booked=[_booked_transaction(amount=-100.0, day=5)]
    )

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 2


def test_sync_matches_expected_by_other_party_substring(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    seed_account_with_expectation(
        session_factory=session_factory, credential_id=credential_id, amount=-50.0, tolerance=0, other_party="Netflix"
    )

    booking = FetchedTransaction(
        amount=-50.0,
        purpose="Subscription",
        date=date(year=2026, month=5, day=6),
        other_party="NETFLIX INTL BV",
    )
    sync_with_booked(session_factory=session_factory, credential_id=credential_id, booked=[booking])

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 1
        assert transactions[0].expected is False
        assert transactions[0].other_party == "NETFLIX INTL BV"


def test_sync_keeps_expected_when_other_party_does_not_match(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    seed_account_with_expectation(
        session_factory=session_factory, credential_id=credential_id, amount=-50.0, tolerance=0, other_party="Netflix"
    )

    booking = FetchedTransaction(
        amount=-50.0,
        purpose="Subscription",
        date=date(year=2026, month=5, day=6),
        other_party="Spotify AB",
    )
    sync_with_booked(session_factory=session_factory, credential_id=credential_id, booked=[booking])

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 2


def test_sync_consumes_only_one_expectation_per_booking(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        make_transaction(
            session,
            account_id=account.id,
            amount=-100.0,
            date=OLDER_DATE,
            pending=True,
            expected=True,
            match_tolerance_percent=0,
        )
        make_transaction(
            session,
            account_id=account.id,
            amount=-100.0,
            date=OLDER_DATE,
            pending=True,
            expected=True,
            match_tolerance_percent=0,
        )
        session.commit()

    sync_with_booked(
        session_factory=session_factory, credential_id=credential_id, booked=[_booked_transaction(amount=-100.0, day=5)]
    )

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 2  # one expectation resolved, one still pending
        assert sum(tx.expected for tx in transactions) == 1
        assert sum(not tx.expected for tx in transactions) == 1


def test_sync_tolerance_zero_requires_exact_amount(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    seed_account_with_expectation(
        session_factory=session_factory, credential_id=credential_id, amount=-9.99, tolerance=0
    )

    # Booking off by one cent must NOT match at tolerance 0.
    sync_with_booked(
        session_factory=session_factory, credential_id=credential_id, booked=[_booked_transaction(amount=-9.98, day=5)]
    )
    with session_factory() as session:
        assert len(session.get(entity=Credential, ident=credential_id).accounts[0].transactions) == 2

    # The exact amount resolves it (and float noise around 9.99 is tolerated by the epsilon).
    sync_with_booked(
        session_factory=session_factory, credential_id=credential_id, booked=[_booked_transaction(amount=-9.99, day=6)]
    )
    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert sum(tx.expected for tx in transactions) == 0


def test_sync_appends_expected_note_when_booking_already_has_one(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        make_transaction(
            session,
            account_id=account.id,
            amount=-30.0,
            date=OLDER_DATE,
            note="from grandma",
            pending=True,
            expected=True,
            match_tolerance_percent=0,
        )
        make_transaction(
            session,
            account_id=account.id,
            amount=-30.0,
            date=date(year=2026, month=5, day=7),
            other_party="ACME",
            note="bank note",
        )
        session.commit()

    sync_with_booked(session_factory=session_factory, credential_id=credential_id, booked=[])

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 1
        assert transactions[0].note == "bank note\nfrom grandma"


def test_sync_does_not_match_a_booking_that_predates_the_expectation(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        make_transaction(
            session, account_id=account.id, amount=-30.0, date=date(year=2026, month=2, day=15), other_party="ACME"
        )
        make_transaction(
            session,
            account_id=account.id,
            amount=-30.0,
            date=OLDER_DATE,
            pending=True,
            expected=True,
            match_tolerance_percent=0,
        )
        session.commit()

    sync_with_booked(session_factory=session_factory, credential_id=credential_id, booked=[])

    with session_factory() as session:
        transactions = session.get(entity=Credential, ident=credential_id).accounts[0].transactions
        assert len(transactions) == 2  # the old booking stays, the expectation is kept
        assert sum(tx.expected for tx in transactions) == 1


def test_sync_records_bank_reported_balance_observations_as_anchors(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    anchor_day = RECENT_DATE
    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 1000.0},
            transactions={ACCOUNT_IBAN: []},
            observations={ACCOUNT_IBAN: [BalanceObservation(date=anchor_day, amount=625.15)]},
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        snapshot = credential.accounts[0].balance_at_date[anchor_day]
        assert snapshot.balance == 625.15
        assert snapshot.source == BalanceSnapshotSource.BANK_REPORTED


def test_sync_passes_a_plain_date_to_handlers_when_credential_was_synced_before(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    fake_session = FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={ACCOUNT_IBAN: []},
    )
    handler = build_handler(fake_session)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)

    _, requested_start = fake_session.get_transactions_calls[0]
    assert not isinstance(requested_start, datetime)
    assert requested_start == LAST_FETCHING_TIMESTAMP.date()


def test_sync_fetches_full_history_when_credential_was_never_synced(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, last_fetching_timestamp=None)
        session.commit()
        credential_id = credential.id

    fake_session = FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={ACCOUNT_IBAN: []},
    )
    handler = build_handler(fake_session)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)

    requested_account_name, requested_start = fake_session.get_transactions_calls[0]
    assert requested_account_name == ACCOUNT_IBAN
    assert isinstance(requested_start, date)
    assert requested_start == date(year=1970, month=1, day=1)


def _market_valued_handler(market_day: date, transactions: list[FetchedTransaction] | None = None) -> MagicMock:
    return build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 4200.0},
            transactions={ACCOUNT_IBAN: transactions or []},
            market_values={ACCOUNT_IBAN: [BalanceObservation(date=market_day, amount=4200.0)]},
        )
    )


def test_sync_records_market_value_history_as_market_valued_snapshots(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    market_day = date(year=2026, month=5, day=2)
    buy = FetchedTransaction(
        amount=-100.0,
        purpose="Buy",
        date=RECENT_DATE,
        other_party="Broker",
        transaction_type=TransactionType.BUY,
    )
    handler = _market_valued_handler(market_day=market_day, transactions=[buy])

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        account = session.get(entity=Credential, ident=credential_id).accounts[0]
        snapshot = account.balance_at_date[market_day]
        assert snapshot.balance == 4200.0
        assert snapshot.source == BalanceSnapshotSource.MARKET_VALUED
        assert RECENT_DATE not in account.balance_at_date


def test_market_valued_snapshots_survive_a_recompute(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    market_day = date(year=2026, month=5, day=2)
    handler = _market_valued_handler(market_day=market_day)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        account = session.get(entity=Credential, ident=credential_id).accounts[0]
        account.recompute_balances_at_date()
        session.commit()

    with session_factory() as session:
        account = session.get(entity=Credential, ident=credential_id).accounts[0]
        assert account.balance_at_date[market_day].source == BalanceSnapshotSource.MARKET_VALUED


def test_incomplete_history_accounts_keep_anchors_but_skip_the_transaction_walk(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    anchor_day = RECENT_DATE
    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN, transaction_history_incomplete=True)],
            balances={ACCOUNT_IBAN: 0.0},
            transactions={
                ACCOUNT_IBAN: [
                    FetchedTransaction(amount=-100.0, purpose="PayPal payment", date=OLDER_DATE, other_party="Shop")
                ]
            },
            observations={ACCOUNT_IBAN: [BalanceObservation(date=anchor_day, amount=0.0)]},
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        account = session.get(entity=Credential, ident=credential_id).accounts[0]
        assert account.transaction_history_incomplete is True
        assert len(account.transactions) == 1
        snapshots = account.balance_at_date
        assert set(snapshots) == {anchor_day}
        assert snapshots[anchor_day].source == BalanceSnapshotSource.BANK_REPORTED
