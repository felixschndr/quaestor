import datetime
from typing import TYPE_CHECKING

from pytr.event import PPEventType
from source.backend.models.base import Base
from sqlalchemy import Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.account import Account


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    amount: Mapped[float] = mapped_column(Float)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    date: Mapped[datetime.date] = mapped_column(Date)
    other_party: Mapped[str | None] = mapped_column(String, nullable=True)
    portfolio_transaction_type: Mapped[PPEventType | None] = mapped_column(SQLEnum(PPEventType), nullable=True)

    account: Mapped["Account"] = relationship(back_populates="transactions")
