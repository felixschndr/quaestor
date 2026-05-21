from datetime import date

from source.backend.bank_handlers import BankProvider
from source.backend.models.account import Account
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.user import User
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD_HASH,
)


def _persist_account(session: Session, balance: float, transactions: list[tuple[date, float]]) -> Account:
    user = User(user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash=VALID_PASSWORD_HASH)  # nosec B106
    credential = Credential(
        user=user,
        bank=BankProvider.ING,
        credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
        requires_two_factor_authentication=False,
    )
    account = Account(name="x", balance=balance, credential=credential)
    for day, amount in transactions:
        account.transactions.append(Transaction(amount=amount, date=day, purpose=None, other_party=None))
    session.add(account)
    session.flush()
    return account


def _get_persisted_snapshots(session: Session, account: Account) -> dict[date, float]:
    rows = session.scalars(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account.id)).all()
    return {row.date: row.balance for row in rows}


def test_account_repr_contains_identifying_fields():
    account = Account(id=42, credential_id=7, name="Checking", balance=123.45, balance_factor=80)

    assert repr(account) == "<Account(id=42, credential_id=7, name=Checking, balance=123.45, balance_factor=80)>"


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
