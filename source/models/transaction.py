from datetime import datetime
from typing import TYPE_CHECKING

from source.models.base import Base
from sqlalchemy import DateTime, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.models.account import Account


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    amount: Mapped[float] = mapped_column(Float)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))

    account: Mapped["Account"] = relationship(back_populates="transactions")
