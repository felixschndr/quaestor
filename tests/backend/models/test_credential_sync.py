from contextlib import contextmanager
from datetime import date, datetime
from unittest.mock import MagicMock

from source.backend.bank_handlers.base import (
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.models.credential import Credential
from source.backend.models.transaction_type import TransactionType
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    ACCOUNT_IBAN,
    LAST_FETCHING_TIMESTAMP,
    SECOND_ACCOUNT_IBAN,
    TRANSACTION_DATE,
    make_account,
    make_credential,
    make_user,
    persist_credential_with_new_user,
)


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
    credential_id = persist_credential_with_new_user(session_factory)
    fake_account = FetchedAccount(name=ACCOUNT_IBAN)
    transactions = [
        FetchedTransaction(
            amount=-12.34,
            purpose="Coffee",
            date=TRANSACTION_DATE,
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
            balances={ACCOUNT_IBAN: 1000.0},
            transactions={ACCOUNT_IBAN: transactions},
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
        assert account.name == ACCOUNT_IBAN
        assert account.balance == 1000.0
        assert {tx.amount for tx in account.transactions} == {-12.34, 2500.0}
        expected_days = {TRANSACTION_DATE, date(year=2026, month=5, day=1)}
        assert expected_days <= set(account.balance_at_date.keys())
        assert credential.last_fetching_timestamp is not None


def test_sync_matches_existing_account_by_name_and_adds_missing_ones(session_factory: sessionmaker):
    credential_id = persist_credential_with_new_user(session_factory)
    with session_factory() as session:
        make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        session.commit()

    handler = _build_handler(
        _FakeBankSession(
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

    handler = _build_handler(
        _FakeBankSession(
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
    handler = _build_handler(
        _FakeBankSession(
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
    bank = _FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={
            ACCOUNT_IBAN: [_booked_transaction(amount=-10.0, day=10), _pending_transaction(amount=-20.0, day=11)]
        },
    )
    handler = _build_handler(bank)

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
    bank = _FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={ACCOUNT_IBAN: [_pending_transaction(amount=-142.0, day=4)]},
    )
    handler = _build_handler(bank)

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
    handler = _build_handler(
        _FakeBankSession(
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


def test_sync_passes_a_plain_date_to_handlers_when_credential_was_synced_before(session_factory: sessionmaker):
    # last_fetching_timestamp is a datetime, but handlers are contracted to receive a date
    # (get_transactions(start_date: date)). Passing a datetime breaks handlers that compare it
    # against transaction dates (e.g. DFS: `transaction.date >= start_date`).
    credential_id = persist_credential_with_new_user(session_factory)
    fake_session = _FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={ACCOUNT_IBAN: []},
    )
    handler = _build_handler(fake_session)

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

    fake_session = _FakeBankSession(
        accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
        balances={ACCOUNT_IBAN: 0.0},
        transactions={ACCOUNT_IBAN: []},
    )
    handler = _build_handler(fake_session)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)

    requested_account_name, requested_start = fake_session.get_transactions_calls[0]
    assert requested_account_name == ACCOUNT_IBAN
    assert isinstance(requested_start, date)
    assert requested_start == date(year=1970, month=1, day=1)
