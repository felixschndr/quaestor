from __future__ import annotations

import sys
import warnings
from datetime import date, datetime, timedelta
from pathlib import Path

warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient` is deprecated")

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from source.backend.bank_handlers import BankProvider
from source.backend.db import SessionLocal
from source.backend.helpers import utc_now
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_group import AccountGroup
from source.backend.models.auth.user import User
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.contracts.contract_frequency import ContractFrequency
from source.backend.models.contracts.contract_source import ContractSource
from source.backend.models.notifications.notification_rule import (
    BalanceDirection,
    DigestPeriod,
    NotificationRule,
    NotificationTrigger,
)
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_attachment import (
    TransactionAttachment,
)
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.paths import DATABASE_PATH
from source.backend.services.auth.password_service import hash_password
from source.backend.services.core import migrations
from tests.backend.conftest import (
    DISPLAY_NAME,
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    USER_NAME,
    VALID_PASSWORD,
    _default_credentials_for,
    make_account,
    make_contract,
    make_credential,
    make_transaction,
    make_user,
)

TODAY = date.today()

GROUP_EVERYDAY = "Everyday"
GROUP_SAVINGS = "Savings"
GROUP_INVESTMENTS = "Investments"

ACCOUNT_SPECS: list[tuple[str, BankProvider, str, int]] = [
    (GROUP_EVERYDAY, BankProvider.FINTS, "Checking", 100),
    (GROUP_EVERYDAY, BankProvider.ENABLE_BANKING, "Shared Account with SO", 50),
    (GROUP_SAVINGS, BankProvider.MANUAL, "Cash at home", 100),
    (GROUP_SAVINGS, BankProvider.DFS, "Home Loan Savings", 100),
    (GROUP_INVESTMENTS, BankProvider.FIN4U, "Retirement", 100),
    (GROUP_INVESTMENTS, BankProvider.TRADE_REPUBLIC, "Depot", 100),
]

CREDENTIAL_OVERRIDES: dict[BankProvider, dict[str, str]] = {
    BankProvider.ENABLE_BANKING: {"aspsp_name": "Volksbank Mittelhessen", "aspsp_country": "DE"},
}

RECURRING_SPECS = [
    ("ACME Inc.", 2500.00, TransactionType.INCOMING, TransactionCategory.SALARY, "Monthly salary", 3, 5),
    ("Landlord Ltd.", -780.00, TransactionType.OUTGOING, TransactionCategory.RENT, "Rent", 3, 3),
    ("Spotify", -9.99, TransactionType.OUTGOING, TransactionCategory.SUBSCRIPTIONS, "Premium", 3, -20),
]

ONE_OFF_SPECS = [
    (-42.17, "Whole Foods Market", "Weekly groceries", TransactionCategory.SUPERMARKET, 5),
    (-54.80, "Shell Station", "Fuel", TransactionCategory.FUEL, 12),
    (-23.50, "Joe's Diner", "Dinner with friends", TransactionCategory.RESTAURANTS, 15),
    (-129.99, "Amazon", "Order #14582", TransactionCategory.ONLINE_SHOPPING, 20),
    (-19.90, UNKNOWN_TRANSACTION_OTHER_PARTY, "Whatever this was", TransactionCategory.UNKNOWN, 8),
]

CASH_SPECS = [
    (250.00, "ATM Central Station", "Cash withdrawal", TransactionCategory.DEPOSIT, 14),
    (-12.40, "Bakery Müller", "Bread and rolls", TransactionCategory.SUPERMARKET, 11),
    (-8.50, "Cafe Central", "Coffee with mum", TransactionCategory.RESTAURANTS, 9),
    (-35.00, "Flea market", "Vinyl records", TransactionCategory.ENTERTAINMENT, 6),
    (-15.00, "Taxi", "Ride home", TransactionCategory.TRAVEL, 4),
    (-20.00, "Birthday card", "Present for Bob", TransactionCategory.GIFTS, 2),
]


def _link_transactions(outflow: Transaction, inflow: Transaction) -> None:
    outflow.transfer_original_type = outflow.transaction_type
    inflow.transfer_original_type = inflow.transaction_type
    outflow.transaction_type = TransactionType.TRANSFER_OUT
    inflow.transaction_type = TransactionType.TRANSFER_IN
    outflow.transfer_counterpart_id = inflow.id
    inflow.transfer_counterpart_id = outflow.id


def _seed_recurring(session: Session, account: Account) -> None:
    for other_party, amount, transaction_type, category, purpose, months, due_in_days in RECURRING_SPECS:
        for month in range(months):
            make_transaction(
                session,
                account_id=account.id,
                amount=amount,
                purpose=purpose,
                other_party=other_party,
                date=TODAY - timedelta(days=30 * month + 30 - due_in_days),
                transaction_type=transaction_type,
                category=category,
            )


def _seed_one_offs(session: Session, account: Account, specs: list = ONE_OFF_SPECS) -> None:
    for amount, other_party, purpose, category, days_ago in specs:
        make_transaction(
            session,
            account_id=account.id,
            amount=amount,
            purpose=purpose,
            other_party=other_party,
            date=TODAY - timedelta(days=days_ago),
            transaction_type=TransactionType.from_amount(amount),
            category=category,
        )


def _seed_expected(session: Session, account: Account) -> None:
    make_transaction(
        session,
        account_id=account.id,
        amount=-60.00,
        purpose="Electricity",
        other_party="City Utilities",
        date=TODAY + timedelta(days=4),
        transaction_type=TransactionType.OUTGOING,
        category=TransactionCategory.UTILITIES,
        pending=True,
        expected=True,
        match_tolerance_percent=10,
    )


def _seed_notification_rules(session: Session, user: User, account_ids: list[int]) -> None:
    session.add_all(
        [
            NotificationRule(
                user_id=user.id,
                name="Big spendings",
                trigger=NotificationTrigger.TRANSACTION,
                account_ids=account_ids,
                categories=[TransactionCategory.ONLINE_SHOPPING.value, TransactionCategory.RENT.value],
                types=[TransactionType.OUTGOING.value],
                max_amount=-100.0,
            ),
            NotificationRule(
                user_id=user.id,
                name="Groceries",
                trigger=NotificationTrigger.TRANSACTION,
                account_ids=[],
                categories=[TransactionCategory.SUPERMARKET.value],
                types=[TransactionType.OUTGOING.value],
                other_party_contains="Market",
            ),
            NotificationRule(
                user_id=user.id,
                name="Checking runs dry",
                trigger=NotificationTrigger.BALANCE_THRESHOLD,
                account_ids=account_ids[:1],
                threshold=500.0,
                direction=BalanceDirection.BELOW,
            ),
            NotificationRule(
                user_id=user.id,
                name="Overdue contracts",
                trigger=NotificationTrigger.CONTRACT_OVERDUE,
                account_ids=[],
                days=5,
            ),
            NotificationRule(
                user_id=user.id,
                name="Upcoming shortfall",
                trigger=NotificationTrigger.UPCOMING_SHORTFALL,
                account_ids=[],
                days=7,
            ),
            NotificationRule(
                user_id=user.id,
                name="Double bookings",
                trigger=NotificationTrigger.DUPLICATE_TRANSACTION,
                account_ids=[],
                days=3,
                include_content=False,
            ),
            NotificationRule(
                user_id=user.id,
                name="Expected transactions",
                trigger=NotificationTrigger.EXPECTED_TRANSACTION,
                account_ids=[],
            ),
            NotificationRule(
                user_id=user.id,
                name="Weekly digest",
                trigger=NotificationTrigger.DIGEST,
                account_ids=[],
                period=DigestPeriod.WEEKLY,
                enabled=True,
            ),
        ]
    )


def _drop_database() -> None:
    for path in DATABASE_PATH.parent.glob(f"{DATABASE_PATH.name}*"):
        path.unlink()
    print(f"Deleted {DATABASE_PATH}")


def _seed_note_and_attachment_for_screenshot(session: Session) -> None:
    transaction = session.get(Transaction, 10)
    if transaction is None:
        return
    transaction.note = "Ingredients for dinner with Joe"
    receipt = b"%PDF-1.4 demo receipt"
    transaction.attachments.append(
        TransactionAttachment(
            filename="Receipt.pdf",
            content_type="application/pdf",
            size=int(1.1 * 1024 * 1024),
            data=receipt,
            created_at=utc_now(),
        )
    )


def fill_db_with_testdata() -> None:
    _drop_database()
    migrations.upgrade_to_head()
    with SessionLocal() as session:
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
                credentials=_default_credentials_for(bank) | CREDENTIAL_OVERRIDES.get(bank, {}),
                last_fetching_timestamp=last_synced,
                requires_two_factor_authentication=bank in {BankProvider.FINTS, BankProvider.TRADE_REPUBLIC},
            )
            for bank in BankProvider
        }

        groups = {
            name: AccountGroup(user_id=user.id, name=name, position=position)
            for position, name in enumerate([GROUP_EVERYDAY, GROUP_SAVINGS, GROUP_INVESTMENTS])
        }
        session.add_all(groups.values())
        session.flush()

        position_in_group: dict[int, int] = {}
        accounts: list[Account] = []
        for index, (group_name, bank, display_name, balance_factor) in enumerate(ACCOUNT_SPECS):
            account = make_account(
                session,
                credential_id=credentials_by_bank[bank].id,
                name=f"{bank.value}-demo-{index}",
                display_name=display_name,
                balance=1000.0 + 250.0 * index,
                balance_factor=balance_factor,
            )
            if bank == BankProvider.MANUAL:
                _seed_one_offs(session, account=account, specs=CASH_SPECS)
            else:
                if index == 0:
                    _seed_recurring(session, account=account)
                _seed_one_offs(session, account=account)
                _seed_expected(session, account=account)
            account.update_balance_at_date()

            group = groups[group_name]
            account.group_id = group.id
            account.position = position_in_group.get(group.id, 0)
            position_in_group[group.id] = account.position + 1
            accounts.append(account)

        gym = make_contract(
            session,
            account_id=accounts[0].id,
            name="Gym",
            source=ContractSource.MANUAL,
            category=TransactionCategory.SUBSCRIPTIONS,
            frequency=ContractFrequency.MONTHLY,
            interval_days=ContractFrequency.MONTHLY.interval_days,
        )
        for month in range(6):
            membership_fee = make_transaction(
                session,
                account_id=accounts[0].id,
                amount=-34.90 if month == 2 else -29.90,
                purpose="Membership fee",
                other_party="FitLife Gym",
                date=TODAY - timedelta(days=30 * month + 20),
                transaction_type=TransactionType.OUTGOING,
                category=TransactionCategory.SUBSCRIPTIONS,
            )
            membership_fee.contract_id = gym.id
            membership_fee.contract_assignment = ContractAssignment.MANUAL

        outflow = make_transaction(
            session,
            account_id=accounts[0].id,
            amount=-200.00,
            purpose="Transfer to savings",
            other_party=DISPLAY_NAME,
            date=TODAY - timedelta(days=6),
            transaction_type=TransactionType.OUTGOING,
            category=TransactionCategory.SAVINGS,
        )
        inflow = make_transaction(
            session,
            account_id=accounts[3].id,
            amount=200.00,
            purpose="Transfer to savings",
            other_party=DISPLAY_NAME,
            date=TODAY - timedelta(days=6),
            transaction_type=TransactionType.INCOMING,
            category=TransactionCategory.SAVINGS,
        )
        session.flush()
        _link_transactions(outflow, inflow)

        _seed_notification_rules(session, user=user, account_ids=[account.id for account in accounts])

        _seed_note_and_attachment_for_screenshot(session)

        session.commit()
    print(f"Created demo data: user '{USER_NAME}' / password '{VALID_PASSWORD}'")


if __name__ == "__main__":
    fill_db_with_testdata()
