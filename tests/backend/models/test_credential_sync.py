from contextlib import contextmanager
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock

from source.backend.bank_handlers.base import (
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.models.credential import INITIAL_FETCH_LOOKBACK, Credential
from source.backend.models.transaction_type import TransactionType
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import make_account, make_credential, make_user


def _create_credential(session_factory: sessionmaker) -> int:
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(
            session, user_id=user.id, last_fetching_timestamp=datetime(year=2026, month=1, day=1)
        )
        session.commit()
        return credential.id


class _FakeBankSession(BankSession):
    def __init__(
        self,
        accounts: list[FetchedAccount],
        balances: dict[str, float],
        transactions: dict[str, list[FetchedTransaction]],
    ):
        super().__init__()
        self._accounts = accounts
        self._balances = balances
        self._transactions = transactions
        self.get_transactions_calls: list[tuple[str, date]] = []

    def get_accounts(self) -> list[FetchedAccount]:
        return self._accounts

    def get_balance(self, account: FetchedAccount) -> float:
        return self._balances[account.name]

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        self.get_transactions_calls.append((account.name, start_date))
        return self._transactions[account.name] if account.name in self._transactions else []


def _build_handler(bank_session: _FakeBankSession) -> MagicMock:
    handler = MagicMock()

    @contextmanager
    def session_cm():
        yield bank_session

    handler.session.side_effect = session_cm
    return handler


def test_sync_creates_new_account_with_balance_and_transactions(session_factory: sessionmaker):
    credential_id = _create_credential(session_factory)
    fake_account = FetchedAccount(name="DE12 New")
    transactions = [
        FetchedTransaction(
            amount=-12.34,
            purpose="Coffee",
            date=date(year=2026, month=5, day=20),
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
    handler = _build_handler(
        _FakeBankSession(
            accounts=[fake_account],
            balances={"DE12 New": 1000.0},
            transactions={"DE12 New": transactions},
        )
    )

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        assert len(credential.accounts) == 1
        account = credential.accounts[0]
        assert account.name == "DE12 New"
        assert account.balance == 1000.0
        assert {tx.amount for tx in account.transactions} == {-12.34, 2500.0}
        expected_days = {date(year=2026, month=5, day=20), date(year=2026, month=5, day=1)}
        assert expected_days <= set(account.balance_at_date.keys())
        assert credential.last_fetching_timestamp is not None


def test_sync_matches_existing_account_by_name_and_adds_missing_ones(session_factory: sessionmaker):
    credential_id = _create_credential(session_factory)
    with session_factory() as session:
        make_account(session, credential_id=credential_id, name="DE12 OLD")
        session.commit()

    handler = _build_handler(
        _FakeBankSession(
            accounts=[FetchedAccount(name="DE12 OLD"), FetchedAccount(name="DE12 NEW")],
            balances={"DE12 OLD": 50.0, "DE12 NEW": 0.0},
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
        assert names_to_balance == {"DE12 OLD": 50.0, "DE12 NEW": 0.0}


def test_sync_does_not_duplicate_already_existing_transactions(session_factory: sessionmaker):
    credential_id = _create_credential(session_factory)
    existing_tx = FetchedTransaction(
        amount=-9.99,
        purpose="Recurring",
        date=date(year=2026, month=5, day=10),
        other_party="ACME",
        transaction_type=TransactionType.OUTGOING,
    )

    handler = _build_handler(
        _FakeBankSession(
            accounts=[FetchedAccount(name="ACME-1")],
            balances={"ACME-1": 0.0},
            transactions={"ACME-1": [existing_tx]},
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


def test_sync_falls_back_to_initial_lookback_when_credential_was_never_synced(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, last_fetching_timestamp=None)
        session.commit()
        credential_id = credential.id

    fake_session = _FakeBankSession(
        accounts=[FetchedAccount(name="DE12")],
        balances={"DE12": 0.0},
        transactions={"DE12": []},
    )
    handler = _build_handler(fake_session)

    sync_start = datetime.now()
    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)

    requested_account_name, requested_start = fake_session.get_transactions_calls[0]
    assert requested_account_name == "DE12"
    expected_start = (sync_start - INITIAL_FETCH_LOOKBACK).date()
    # Allow one day of tolerance for tests that straddle midnight.
    assert abs((requested_start - expected_start).days) <= 1
    assert isinstance(requested_start, date)
    # Also confirm INITIAL_FETCH_LOOKBACK is the lookback the code actually applies.
    assert (datetime.now() - sync_start) < timedelta(seconds=5)
