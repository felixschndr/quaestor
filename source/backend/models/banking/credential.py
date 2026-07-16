from datetime import date, datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.bank_handlers import BankHandler, BankProvider, handler_for
from source.backend.bank_handlers.base import BankSession, FetchedAccount
from source.backend.helpers import (
    get_key_of_transaction,
    index_transactions_for_matching,
    utc_now,
)
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.base import Base
from source.backend.models.transactions.transaction import Transaction
from source.backend.services.banking import bank_catalog

logger = get_logger(__name__)

if TYPE_CHECKING:
    from source.backend.models.auth.user import User


class Credential(Base):
    __tablename__ = "credentials"
    __repr_exclude__ = frozenset({"credentials", "session_state"})

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    credentials: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)  # e.g., username, password, pin, ...

    session_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_fetching_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requires_two_factor_authentication: Mapped[bool] = mapped_column(default=False)
    sync_enabled: Mapped[bool] = mapped_column(default=True)

    user: Mapped["User"] = relationship(back_populates="credentials")
    accounts: Mapped[List["Account"]] = relationship(back_populates="credential", cascade="all, delete-orphan")

    @property
    def handler(self) -> BankHandler:
        return handler_for(provider=self.bank, credentials=self.credentials)

    @property
    def bank_name(self) -> str | None:
        return self._bank_name_and_icon()[0]

    @property
    def bank_icon(self) -> str | None:
        return self._bank_name_and_icon()[1]

    def _bank_name_and_icon(self) -> tuple[str | None, str | None]:
        return bank_catalog.get_name_and_icon_of_provider(
            provider=self.bank.value,
            blz=self.credentials.get("blz"),
            aspsp_name=self.credentials.get("aspsp_name"),
        )

    def sync(self, handler: BankHandler) -> None:
        by_name = {account.name: account for account in self.accounts}

        transactions_since = (
            # Day 2: some PSD2 ASPSPs (e.g. PayPal) reject 1970-01-01 as "earlier than 1970" once it shifts across a
            # timezone
            date(year=1970, month=1, day=2)
            if self.last_fetching_timestamp is None
            else self.last_fetching_timestamp.date()
        )
        with handler.session() as bank:
            created_accounts, updated_accounts, created_transactions = self._sync_accounts_of_credential(
                bank_session=bank, by_name=by_name, transactions_since=transactions_since
            )
        self.last_fetching_timestamp = utc_now()
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
            account.transaction_history_incomplete = fetched_account.transaction_history_incomplete
            account.balance = bank_session.get_balance(fetched_account)

            created_transactions += self._sync_transactions_of_account(
                account=account,
                bank_session=bank_session,
                fetched_account=fetched_account,
                transactions_since=transactions_since,
            )

            market_value_history = bank_session.get_market_value_history(fetched_account)
            if market_value_history:
                account.record_market_value_history(market_value_history)
            else:
                account.record_balance_observations(bank_session.get_balance_observations(fetched_account))
                account.recompute_balances_at_date()
        return created_accounts, updated_accounts, created_transactions

    @staticmethod
    def _sync_transactions_of_account(
        account: Account,
        bank_session: BankSession,
        fetched_account: FetchedAccount,
        transactions_since: date,
    ) -> int:
        fetched_transactions = bank_session.get_transactions(account=fetched_account, start_date=transactions_since)

        # Bank "Vormerkungen" (pending, NOT expected) have no stable identity — their
        # date/purpose/other_party can still change before they book. Instead of trying to match them
        # across syncs (which creates duplicates), we treat them as ephemeral: drop the old ones and
        # rebuild from scratch. User-created expected transactions (pending AND expected) are kept.
        pending_transactions = [
            transaction for transaction in account.transactions if transaction.pending and not transaction.expected
        ]
        for pending_transaction in pending_transactions:
            account.transactions.remove(pending_transaction)

        existing_transactions = index_transactions_for_matching(
            transaction for transaction in account.transactions if not transaction.expected
        )
        created_transactions = 0

        for fetched_transaction in fetched_transactions:
            if fetched_transaction.pending:
                account.transactions.append(Transaction.from_fetched(fetched_transaction))
                continue

            reference = fetched_transaction.bank_reference
            if reference and reference in existing_transactions:
                continue

            key = get_key_of_transaction(fetched_transaction)
            matched = existing_transactions.get(key)
            if matched is not None and not (reference and matched.bank_reference):
                if reference:
                    matched.bank_reference = reference  # backfill rows from before the id existed
                    existing_transactions[reference] = matched
                continue

            transaction = Transaction.from_fetched(fetched_transaction)
            account.transactions.append(transaction)
            existing_transactions[key] = transaction
            if reference:
                existing_transactions[reference] = transaction
            created_transactions += 1

        Credential._match_expected_transactions(account=account)
        return created_transactions

    _TOLERANCE_FOR_EXACT_COMPARISON = 0.005

    @staticmethod
    def _match_expected_transactions(account: Account) -> None:
        expected_transactions = [t for t in account.transactions if t.expected]
        if not expected_transactions:
            return

        booked_transactions = [t for t in account.transactions if not t.pending and not t.expected]

        consumed_transaction_ids: set[int] = set()
        matched_expected_transactions = 0
        for expected_transaction in sorted(expected_transactions, key=lambda t: t.id):
            tolerance = (expected_transaction.match_tolerance_percent or 0) / 100.0
            allowed = abs(expected_transaction.amount) * tolerance + Credential._TOLERANCE_FOR_EXACT_COMPARISON
            needle = expected_transaction.other_party.strip().lower() if expected_transaction.other_party else None

            candidates = []
            for booked_transaction in booked_transactions:
                if id(booked_transaction) in consumed_transaction_ids:
                    continue
                if booked_transaction.date < expected_transaction.date:
                    continue
                if (booked_transaction.amount >= 0) != (expected_transaction.amount >= 0):
                    continue
                if abs(booked_transaction.amount - expected_transaction.amount) > allowed:
                    continue
                if needle is not None:
                    haystack = " ".join(
                        filter(None, [booked_transaction.other_party, booked_transaction.purpose])
                    ).lower()
                    if needle not in haystack:
                        continue
                candidates.append(booked_transaction)

            if not candidates:
                continue
            best_match = min(candidates, key=lambda b: (abs(b.amount - expected_transaction.amount), b.date, b.id or 0))
            Credential._carry_over_expected_note(
                booked_transaction=best_match, expected_transaction=expected_transaction
            )
            consumed_transaction_ids.add(id(best_match))
            account.transactions.remove(expected_transaction)
            matched_expected_transactions += 1

        if matched_expected_transactions:
            logger.info(f"Resolved {matched_expected_transactions} expected transaction(s) on {account}")

    @staticmethod
    def _carry_over_expected_note(booked_transaction: Transaction, expected_transaction: Transaction) -> None:
        if not expected_transaction.note:
            return
        booked_transaction.note = (
            expected_transaction.note
            if not booked_transaction.note
            else f"{booked_transaction.note}\n{expected_transaction.note}"
        )
