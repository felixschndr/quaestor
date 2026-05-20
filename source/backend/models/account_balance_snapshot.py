import datetime
from typing import TYPE_CHECKING

from source.backend.models.base import Base
from sqlalchemy import Date, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.account import Account


class AccountBalanceSnapshot(Base):
    __tablename__ = "account_balance_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "date", name="uq_balance_snapshot_account_date"),)  # noqa: FKA100

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    date: Mapped[datetime.date] = mapped_column(Date)
    balance: Mapped[float] = mapped_column(Float)

    account: Mapped["Account"] = relationship(back_populates="balance_at_date")
