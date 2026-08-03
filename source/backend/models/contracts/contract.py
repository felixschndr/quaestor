import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint, event, update
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.contracts.contract_frequency import ContractFrequency
from source.backend.models.contracts.contract_source import ContractSource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory

if TYPE_CHECKING:
    from sqlalchemy import Connection
    from sqlalchemy.orm import Mapper

    from source.backend.models.accounts.account import Account

# A transaction is an outlier when |amount - median| exceeds a tolerance band. The band is the
# spread (MAD) scaled by OUTLIER_SPREAD_FACTOR, but bounded on both ends:
#   - floored at OUTLIER_ABSOLUTE_FLOOR so cent-sized noise on stable contracts is never flagged,
#   - capped at OUTLIER_RELATIVE_FACTOR * |median| so a tiny sample (which inflates the MAD) can't
#     widen the band past an obvious percentage swing and swallow real outliers.
OUTLIER_SPREAD_FACTOR = 3.0
OUTLIER_ABSOLUTE_FLOOR = 1.0
OUTLIER_RELATIVE_FACTOR = 0.25

# A contract counts as overdue once the expected next payment is more than this late.
OVERDUE_GRACE = datetime.timedelta(days=5)

# Default lead time for the "contract ending soon" notification.
ENDING_LEAD = datetime.timedelta(days=14)

# How far ahead the "upcoming shortfall" notification adds up due contract payments.
SHORTFALL_LOOKAHEAD = datetime.timedelta(days=7)

# How close together two identical bookings must be for the "duplicate transaction" notification.
DUPLICATE_WINDOW = datetime.timedelta(days=3)


class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = (
        UniqueConstraint("account_id", "fingerprint", name="uq_contracts_account_fingerprint"),  # noqa: FKA100
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)

    name: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    fingerprint: Mapped[str | None] = mapped_column(String, nullable=True)  # matching key
    category: Mapped[TransactionCategory | None] = mapped_column(SQLEnum(TransactionCategory), nullable=True)
    source: Mapped[ContractSource] = mapped_column(SQLEnum(ContractSource))

    median_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    amount_spread: Mapped[float | None] = mapped_column(Float, nullable=True)
    frequency: Mapped[ContractFrequency | None] = mapped_column(SQLEnum(ContractFrequency), nullable=True)
    interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_next_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)  # user-set

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    overdue_notified_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ending_notified_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    account: Mapped["Account"] = relationship(back_populates="contracts")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="contract",
        foreign_keys="Transaction.contract_id",
        viewonly=True,
    )

    def members(self) -> list["Transaction"]:
        return [
            transaction
            for transaction in self.transactions
            if transaction.contract_assignment != ContractAssignment.EXCLUDED
        ]

    def is_overdue_on(self, today: datetime.date, grace: datetime.timedelta | None = None) -> bool:
        if self.expected_next_date is None:
            return False
        return today > self.expected_next_date + (OVERDUE_GRACE if grace is None else grace)

    def is_ending_within(self, today: datetime.date, lead: datetime.timedelta) -> bool:
        if self.end_date is None:
            return False
        return today <= self.end_date <= today + lead

    def is_outlier(self, transaction: "Transaction") -> bool:
        if self.median_amount is None or self.amount_spread is None:
            return False
        relative_cap = OUTLIER_RELATIVE_FACTOR * abs(self.median_amount)
        band = min(OUTLIER_SPREAD_FACTOR * self.amount_spread, relative_cap)
        threshold = max(OUTLIER_ABSOLUTE_FLOOR, band)
        return abs(transaction.amount - self.median_amount) > threshold


@event.listens_for(target=Contract, identifier="before_delete")
def _clear_contract_links(_mapper: "Mapper", connection: "Connection", target: Contract) -> None:
    # SQLite has foreign keys off, so emulate ON DELETE SET NULL and clear the assignment too.
    connection.execute(
        update(Transaction)
        .where(Transaction.contract_id == target.id)
        .values(contract_id=None, contract_assignment=None)
    )
