import datetime
import enum
from typing import TYPE_CHECKING

from sqlalchemy import Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.account import Account


class BalanceSnapshotSource(str, enum.Enum):
    COMPUTED = "COMPUTED"
    BANK_REPORTED = "BANK_REPORTED"
    MARKET_VALUED = "MARKET_VALUED"


class AccountBalanceSnapshot(Base):
    __tablename__ = "account_balance_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "date", name="uq_balance_snapshot_account_date"),)  # noqa: FKA100

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    date: Mapped[datetime.date] = mapped_column(Date)
    balance: Mapped[float] = mapped_column(Float)
    source: Mapped[BalanceSnapshotSource] = mapped_column(
        SQLEnum(BalanceSnapshotSource),
        default=BalanceSnapshotSource.COMPUTED,
        server_default=BalanceSnapshotSource.COMPUTED.value,
    )

    account: Mapped["Account"] = relationship(back_populates="balance_at_date")
