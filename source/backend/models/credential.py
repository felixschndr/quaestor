from datetime import date, datetime
from typing import TYPE_CHECKING, List

from source.backend.bank_handlers import BankHandler, BankProvider, handler_for
from source.backend.bank_handlers.base import BankSession, FetchedAccount
from source.backend.helpers import get_key_of_transaction
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
if TYPE_CHECKING:
    from source.backend.models.user import User


class Credential(Base):
    __tablename__ = "credentials"
    __repr_exclude__ = frozenset({"credentials", "session_state"})

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

        transactions_since = (
            date(year=1970, month=1, day=1)
            if self.last_fetching_timestamp is None
            else self.last_fetching_timestamp.date()
        )
        with handler.session() as bank:
            created_accounts, updated_accounts, created_transactions = self._sync_accounts_of_credential(
                bank_session=bank, by_name=by_name, transactions_since=transactions_since
            )
        self.last_fetching_timestamp = datetime.now()
        logger.info(
            f"Credential {self.id}: {created_accounts} account(s) created, "
            f"{updated_accounts} account(s) updated, {created_transactions} transaction(s) created"
        )

    def _sync_accounts_of_credential(
        self,
        bank_session: BankSession,
        by_name: dict[str, Account],
        transactions_since: date,
    ) -> tuple[int, int, int]:
        created_accounts = 0
        updated_accounts = 0
        created_transactions = 0

        for fetched_account in bank_session.get_accounts():
            account = by_name.get(fetched_account.name)
            if account is None:
                account = Account.from_fetched(fetched_account)
                self.accounts.append(account)
                created_accounts += 1
            elif account.name != fetched_account.name:
                account.name = fetched_account.name
                updated_accounts += 1
            account.balance = bank_session.get_balance(fetched_account)
            account.tracks_balance_history = fetched_account.tracks_balance_history

            created_transactions += self._sync_transactions_of_account(
                account=account,
                bank_session=bank_session,
                fetched_account=fetched_account,
                transactions_since=transactions_since,
            )
            account.recompute_balances_at_date()
        return created_accounts, updated_accounts, created_transactions

    @staticmethod
    def _sync_transactions_of_account(
        account: Account,
        bank_session: BankSession,
        fetched_account: FetchedAccount,
        transactions_since: date,
    ) -> int:
        existing_transactions = {get_key_of_transaction(transaction) for transaction in account.transactions}
        created_transactions = 0

        for fetched_transaction in bank_session.get_transactions(
            account=fetched_account, start_date=transactions_since
        ):
            key = get_key_of_transaction(fetched_transaction)
            if key in existing_transactions:
                continue

            account.transactions.append(Transaction.from_fetched(fetched_transaction))
            existing_transactions.add(key)
            created_transactions += 1
        return created_transactions
