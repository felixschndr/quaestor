from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, List

from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.bank_handlers import BankHandler, BankProvider, handler_for
from source.backend.bank_handlers.base import BalanceObservation, BankSession, FetchedAccount, FetchedTransaction
from source.backend.exceptions import JobErrorCode
from source.backend.helpers import get_key_of_transaction, index_transactions_for_matching, utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.base import Base
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import CategorizationRules
from source.backend.services.banking import bank_catalog

logger = get_logger(__name__)

PENDING_BOOKED_MATCH_WINDOW = timedelta(days=7)

if TYPE_CHECKING:
    from source.backend.models.auth.user import User


@dataclass(frozen=True)
class _FetchedAccountData:
    account: FetchedAccount
    balance: float
    transactions: list[FetchedTransaction]
    market_value_history: list[BalanceObservation]
    balance_observations: list[BalanceObservation]

    @classmethod
    def fetch(
        cls: type["_FetchedAccountData"], bank_session: BankSession, account: FetchedAccount, transactions_since: date
    ) -> "_FetchedAccountData":
        balance = bank_session.get_balance(account)
        transactions = bank_session.get_transactions(account=account, start_date=transactions_since)
        market_value_history = bank_session.get_market_value_history(account)
        return cls(
            account=account,
            balance=balance,
            transactions=transactions,
            market_value_history=market_value_history,
            balance_observations=[] if market_value_history else bank_session.get_balance_observations(account),
        )


class Credential(Base):
    __tablename__ = "credentials"
    __repr_exclude__ = frozenset({"credentials", "session_state", "last_sync_error"})

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    credentials: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)  # e.g., username, password, pin, ...

    session_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_successful_sync_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_attempt_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requires_two_factor_authentication: Mapped[bool] = mapped_column(default=False)
    sync_enabled: Mapped[bool] = mapped_column(default=True)
    last_sync_error: Mapped[str | None] = mapped_column(nullable=True, default=None)
    last_sync_error_code: Mapped[JobErrorCode | None] = mapped_column(
        SQLEnum(JobErrorCode), nullable=True, default=None
    )

    user: Mapped["User"] = relationship(back_populates="credentials")
    accounts: Mapped[List["Account"]] = relationship(back_populates="credential", cascade="all, delete-orphan")

    @property
    def handler(self) -> BankHandler:
        return handler_for(provider=self.bank, credentials=self.credentials)

    @property
    def is_syncable(self) -> bool:
        return self.bank != BankProvider.MANUAL

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
        transactions_since = (
            # some PSD2 ASPSPs (e.g. PayPal) reject 1970-01-01 as "earlier than 1970" once it shifts across a timezone
            date(year=1970, month=1, day=2)
            if self.last_successful_sync_timestamp is None
            else self.last_successful_sync_timestamp.date()
        )
        with handler.session() as bank:
            fetched_accounts = [
                _FetchedAccountData.fetch(bank_session=bank, account=account, transactions_since=transactions_since)
                for account in bank.get_accounts()
            ]
        created_accounts, updated_accounts, created_transactions = self._sync_accounts_of_credential(fetched_accounts)
        self.last_successful_sync_timestamp = utc_now()
        system_id = getattr(bank, "system_id", None)
        if system_id:
            self.credentials = {**self.credentials, "system_id": system_id}
        logger.info(
            f"Credential {self.id}: {created_accounts} account(s) created, "
            f"{updated_accounts} account(s) updated, {created_transactions} transaction(s) created"
        )

    def _sync_accounts_of_credential(self, fetched_accounts: list[_FetchedAccountData]) -> tuple[int, int, int]:
        by_external_id = {account.external_id: account for account in self.accounts if account.external_id}
        by_name = {account.name: account for account in self.accounts}
        rules = self.user.categorization_rules
        created_accounts = 0
        updated_accounts = 0
        created_transactions = 0
        claimed_account_ids: set[int] = set()

        for fetched in fetched_accounts:
            fetched_account = fetched.account
            # Prefer matching by the stable external id
            account = by_external_id.get(fetched_account.external_id) if fetched_account.external_id else None
            if account is None:
                name_match = by_name.get(fetched_account.name)
                if (
                    name_match is not None
                    and name_match.external_id is None
                    and id(name_match) not in claimed_account_ids
                ):
                    account = name_match
            if account is None:
                account = Account(name=fetched_account.name, external_id=fetched_account.external_id)
                self.accounts.append(account)
                created_accounts += 1
            else:
                if account.name != fetched_account.name or account.external_id != fetched_account.external_id:
                    updated_accounts += 1
                account.name = fetched_account.name
                account.external_id = fetched_account.external_id
            claimed_account_ids.add(id(account))
            account.transaction_history_incomplete = fetched_account.transaction_history_incomplete
            account.balance = fetched.balance

            created_transactions += self._sync_transactions_of_account(
                account=account, fetched_transactions=fetched.transactions, rules=rules
            )

            if fetched.market_value_history:
                account.record_market_value_history(fetched.market_value_history)
            else:
                account.record_balance_observations(fetched.balance_observations)
                account.recompute_balances_at_date()

        for account in self.accounts:
            # Banks list only held positions, so a missing one was sold
            if id(account) not in claimed_account_ids and account.is_market_valued and account.balance != 0:
                account.close_sold_position()
        return created_accounts, updated_accounts, created_transactions

    @staticmethod
    def _sync_transactions_of_account(
        account: Account,
        fetched_transactions: list[FetchedTransaction],
        rules: CategorizationRules,
    ) -> int:
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
        fetched_pending_transactions = []

        for fetched_transaction in fetched_transactions:
            if fetched_transaction.pending:
                # Held back until the loop is done and every booking of this sync sits on the account
                fetched_pending_transactions.append(fetched_transaction)
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

            transaction = Transaction.from_fetched(fetched_transaction=fetched_transaction, rules=rules)
            account.transactions.append(transaction)
            existing_transactions[key] = transaction
            if reference:
                existing_transactions[reference] = transaction
            created_transactions += 1

        Credential._add_pending_transactions(
            account=account, fetched_transactions=fetched_pending_transactions, rules=rules
        )
        Credential._match_expected_transactions(account=account)
        return created_transactions

    _TOLERANCE_FOR_EXACT_COMPARISON = 0.005

    @staticmethod
    def _add_pending_transactions(
        account: Account, fetched_transactions: list[FetchedTransaction], rules: CategorizationRules
    ) -> None:
        # Some banks (e.g. ING) keep a pending transaction in their pending list for days after its booking has
        # arrived, so taking that list at face value leaves the transaction on the account twice. The two
        # never share a key (the bank might rewrite purpose and other_party on booking) so match them on the
        # amount within a few days instead.
        unclaimed_bookings = [
            transaction for transaction in account.transactions if not transaction.pending and not transaction.expected
        ]
        for fetched_transaction in fetched_transactions:
            candidates = [
                booking
                for booking in unclaimed_bookings
                if abs(booking.amount - fetched_transaction.amount) <= Credential._TOLERANCE_FOR_EXACT_COMPARISON
                and abs(booking.date - fetched_transaction.date) <= PENDING_BOOKED_MATCH_WINDOW
            ]
            if not candidates:
                account.transactions.append(
                    Transaction.from_fetched(fetched_transaction=fetched_transaction, rules=rules)
                )
                continue
            booking = min(candidates, key=lambda candidate: abs(candidate.date - fetched_transaction.date))
            unclaimed_bookings.remove(booking)
            logger.debug(
                f"Dropping pending {fetched_transaction.amount} of {fetched_transaction.date} on {account}: "
                f"already booked on {booking.date} as transaction {booking.id}"
            )

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
            best_match.matched_expected_id = expected_transaction.id
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
