from datetime import datetime
from typing import TYPE_CHECKING, Any, List

from source.bank_handlers import BankProvider, handler_for
from source.models.base import Base
from source.models.transaction import Transaction
from sqlalchemy import DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.models.user import User


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)

    balance: Mapped[float] = mapped_column(Float, default=0.0)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    provider: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    username: Mapped[str] = mapped_column(String(100))
    # TODO: encrypt at rest before any non-local use
    password: Mapped[str] = mapped_column(String(255))
    last_fetching_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="accounts")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")

    def __init__(self, **kw: Any) -> None:
        kw.setdefault("balance", 0.0)
        super().__init__(**kw)

    def sync(self) -> None:
        handler = handler_for(self.provider, self.username, self.password)
        self.balance = handler.get_balance()
        new_transactions = handler.fetch_new_transactions(self.last_fetching_timestamp)
        for transaction in new_transactions:
            self.transactions.append(Transaction(amount=transaction.amount, timestamp=transaction.timestamp))
        self.last_fetching_timestamp = datetime.now()
