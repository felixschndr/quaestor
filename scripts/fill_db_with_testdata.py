from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from source.backend.bank_handlers import BankProvider  # noqa: E402
from source.backend.db import SessionLocal  # noqa: E402
from source.backend.models.transaction_category import TransactionCategory  # noqa: E402
from source.backend.models.transaction_type import TransactionType  # noqa: E402
from source.backend.models.user import User  # noqa: E402
from source.backend.services import migrations  # noqa: E402
from source.backend.services.password_service import hash_password  # noqa: E402

from tests.backend.conftest import (  # noqa: E402
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)

TODAY = date.today()


def _transactions_for(account_index: int) -> list[dict]:
    base = TODAY - timedelta(days=account_index)
    transactions: list[dict] = [
        {
            "amount": 2500.00,
            "purpose": "Monthly salary",
            "other_party": "ACME Inc.",
            "date": base - timedelta(days=2),
            "transaction_type": TransactionType.INCOMING,
            "category": TransactionCategory.SALARY,
        },
        {
            "amount": -42.17,
            "purpose": "Weekly groceries",
            "other_party": "Whole Foods Market",
            "date": base - timedelta(days=5),
            "transaction_type": TransactionType.OUTGOING,
            "category": TransactionCategory.SUPERMARKET,
            "note": "Bought ingredients for Sunday dinner",
        },
        {
            "amount": -9.99,
            "purpose": "Spotify Premium",
            "other_party": "Spotify",
            "date": base - timedelta(days=8),
            "transaction_type": TransactionType.OUTGOING,
            "category": TransactionCategory.SUBSCRIPTIONS,
        },
        {
            "amount": -54.80,
            "purpose": "Fuel",
            "other_party": "Shell Station",
            "date": base - timedelta(days=12),
            "transaction_type": TransactionType.OUTGOING,
            "category": TransactionCategory.FUEL,
        },
        {
            "amount": -23.50,
            "purpose": "Dinner with friends",
            "other_party": "Joe's Diner",
            "date": base - timedelta(days=15),
            "transaction_type": TransactionType.OUTGOING,
            "category": TransactionCategory.RESTAURANTS,
        },
    ]
    if account_index % 2 == 1:
        transactions.append(
            {
                "amount": -200.00,
                "purpose": "Transfer to savings",
                "other_party": "Self",
                "date": base - timedelta(days=20),
                "transaction_type": TransactionType.OUTGOING,
                "category": TransactionCategory.SAVINGS,
            }
        )
    else:
        transactions.append(
            {
                "amount": -129.99,
                "purpose": "Order #14582",
                "other_party": "Amazon",
                "date": base - timedelta(days=20),
                "transaction_type": TransactionType.OUTGOING,
                "category": TransactionCategory.ONLINE_SHOPPING,
            }
        )
    return transactions


def _account_name(bank: BankProvider, index: int) -> str:
    return f"{bank.value.upper()} demo account {index + 1}"


def _delete_existing_demo_user(db_session: Session) -> None:
    existing = db_session.scalar(select(User).where(User.user_name == USER_NAME))
    if existing is not None:
        db_session.delete(existing)
        db_session.flush()


def fill_db_with_testdata() -> None:
    migrations.upgrade_to_head()
    with SessionLocal() as session:
        _delete_existing_demo_user(session)
        user = make_user(
            session,
            user_name=USER_NAME,
            display_name=DISPLAY_NAME,
            password_hash=hash_password(VALID_PASSWORD),
        )
        account_counter = 0
        for bank in BankProvider:
            credential = make_credential(session, user_id=user.id, bank=bank)
            for index in range(2):
                account = make_account(
                    session,
                    credential_id=credential.id,
                    name=_account_name(bank, index),
                    balance=1000.0 + 250.0 * account_counter,
                )
                for transaction_data in _transactions_for(account_counter):
                    make_transaction(session, account_id=account.id, **transaction_data)
                account_counter += 1
        session.commit()
    print(f"Seeded demo data: user '{USER_NAME}' / password '{VALID_PASSWORD}' with {account_counter} accounts.")


if __name__ == "__main__":
    fill_db_with_testdata()
