from datetime import datetime, timedelta
from typing import TYPE_CHECKING, List

from source.backend.api.helpers import get_key_of_transaction
from source.backend.bank_handlers import BankHandler, BankProvider, handler_for
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.base import Base
from source.backend.models.transaction import Transaction
from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

logger = get_logger(__name__)

# How far back transactions are fetched for a credential that has never been
# synced (set as the initial last_fetching_timestamp on creation).
INITIAL_FETCH_LOOKBACK = timedelta(days=365)

if TYPE_CHECKING:
    from source.backend.models.user import User


class Credential(Base):
    __tablename__ = "credentials"
    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    # "credentials" saves all information required to access the information
    # e.g., username, password, phone number, pin, ...
    credentials: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)

    session_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_fetching_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requires_two_factor_authentication: Mapped[bool] = mapped_column(default=False)

    user: Mapped["User"] = relationship(back_populates="credentials")
    accounts: Mapped[List["Account"]] = relationship(back_populates="credential", cascade="all, delete-orphan")

    @property
    def handler(self) -> BankHandler:
        return handler_for(provider=self.bank, credentials=self.credentials)

    def sync(self, handler: BankHandler) -> None:
        by_name = {account.name: account for account in self.accounts}
        created_accounts = 0
        updated_accounts = 0
        created_transactions = 0
        transactions_since = (self.last_fetching_timestamp or datetime.now() - INITIAL_FETCH_LOOKBACK).date()
        with handler.session() as bank:
            for fetched_account in bank.get_accounts():
                account = by_name.get(fetched_account.name)
                if account is None:
                    account = Account(name=fetched_account.name)
                    self.accounts.append(account)
                    created_accounts += 1
                elif account.name != fetched_account.name:
                    account.name = fetched_account.name
                    updated_accounts += 1
                account.balance = bank.get_balance(fetched_account)

                existing = {get_key_of_transaction(transaction) for transaction in account.transactions}
                for fetched_transaction in bank.get_transactions(
                    account=fetched_account, start_date=transactions_since
                ):
                    key = get_key_of_transaction(fetched_transaction)
                    if key in existing:
                        continue
                    account.transactions.append(
                        Transaction(
                            amount=fetched_transaction.amount,
                            purpose=fetched_transaction.purpose,
                            date=fetched_transaction.date,
                            other_party=fetched_transaction.other_party,
                            portfolio_transaction_type=fetched_transaction.portfolio_transaction_type,
                        )
                    )
                    existing.add(key)
                    created_transactions += 1
        self.last_fetching_timestamp = datetime.now()
        logger.info(
            f"Credential {self.id}: {created_accounts} account(s) created, "
            f"{updated_accounts} account(s) updated, {created_transactions} transaction(s) created"
        )
