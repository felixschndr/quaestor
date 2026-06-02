from __future__ import annotations

import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from source.backend.bank_handlers import BankProvider  # noqa: E402
from source.backend.db import SessionLocal  # noqa: E402
from source.backend.models.account_group import AccountGroup  # noqa: E402
from source.backend.models.transaction import Transaction  # noqa: E402
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

GROUP_EVERYDAY = "Everyday"
GROUP_SAVINGS = "Savings"
GROUP_INVESTMENTS = "Investments"

ACCOUNT_SPECS: list[tuple[str, BankProvider, str, int, bool]] = [
    (GROUP_EVERYDAY, BankProvider.FINTS, "Daily allowance", 100, True),
    (GROUP_EVERYDAY, BankProvider.FINTS, "Shared Account with SO", 50, True),
    (GROUP_SAVINGS, BankProvider.FINTS, "Vacation", 100, True),
    (GROUP_SAVINGS, BankProvider.MANUAL, "Cash at home", 100, True),
    (GROUP_INVESTMENTS, BankProvider.DFS, "Retirement", 100, True),
    (GROUP_INVESTMENTS, BankProvider.FIN4U, "Retirement", 100, True),
    (GROUP_INVESTMENTS, BankProvider.TRADE_REPUBLIC, "Cash", 100, True),
    (GROUP_INVESTMENTS, BankProvider.TRADE_REPUBLIC, "MSCI World", 100, False),
]


def _link_transactions(outflow: Transaction, inflow: Transaction) -> None:
    outflow.transfer_original_type = outflow.transaction_type
    inflow.transfer_original_type = inflow.transaction_type
    outflow.transaction_type = TransactionType.TRANSFER_OUT
    inflow.transaction_type = TransactionType.TRANSFER_IN
    outflow.transfer_counterpart_id = inflow.id
    inflow.transfer_counterpart_id = outflow.id


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
    transactions.append(
        {
            "amount": -780.00,
            "purpose": "Rent",
            "other_party": "Landlord GmbH",
            "date": TODAY + timedelta(days=3),
            "transaction_type": TransactionType.OUTGOING,
            "category": TransactionCategory.RENT,
        }
    )
    return transactions


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

        last_synced = datetime.now() - timedelta(hours=2)

        credentials_by_bank = {
            bank: make_credential(
                session,
                user_id=user.id,
                bank=bank,
                last_fetching_timestamp=last_synced,
                requires_two_factor_authentication=bank in {BankProvider.FINTS, BankProvider.TRADE_REPUBLIC},
            )
            for bank in BankProvider
        }

        groups = {
            GROUP_EVERYDAY: AccountGroup(user_id=user.id, name=GROUP_EVERYDAY, position=0),
            GROUP_SAVINGS: AccountGroup(user_id=user.id, name=GROUP_SAVINGS, position=1),
            GROUP_INVESTMENTS: AccountGroup(user_id=user.id, name=GROUP_INVESTMENTS, position=2),
        }
        session.add_all(groups.values())
        session.flush()

        position_in_group: dict[int, int] = {}
        first_transactions: list[Transaction] = []
        for index, (group_name, bank, display_name, balance_factor, tracks_balance_history) in enumerate(ACCOUNT_SPECS):
            account = make_account(
                session,
                credential_id=credentials_by_bank[bank].id,
                name=f"{bank.value}-demo-{index}",
                display_name=display_name,
                balance=1000.0 + 250.0 * index,
                balance_factor=balance_factor,
                tracks_balance_history=tracks_balance_history,
            )
            account_transactions = [
                make_transaction(session, account_id=account.id, **transaction_data)
                for transaction_data in _transactions_for(index)
            ]
            first_transactions.append(account_transactions[0])
            account.update_balance_at_date()

            group = groups[group_name]
            account.group_id = group.id
            account.position = position_in_group.get(group.id, 0)
            position_in_group[group.id] = account.position + 1

        _link_transactions(first_transactions[0], first_transactions[1])
        _link_transactions(first_transactions[2], first_transactions[3])

        session.commit()
    print(f"Created demo data: user '{USER_NAME}' / password '{VALID_PASSWORD}' with {len(ACCOUNT_SPECS)} accounts.")


if __name__ == "__main__":
    fill_db_with_testdata()
