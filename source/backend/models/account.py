from collections import defaultdict
from datetime import date
from typing import TYPE_CHECKING, List

from source.backend.bank_handlers.base import FetchedAccount
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from source.backend.models.base import Base
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, attribute_keyed_dict, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.credential import Credential
    from source.backend.models.transaction import Transaction


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)

    credential_id: Mapped[int] = mapped_column(ForeignKey("credentials.id"))
    name: Mapped[str] = mapped_column(String(120))
    display_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    balance_factor: Mapped[int] = mapped_column(default=100)

    credential: Mapped["Credential"] = relationship(back_populates="accounts")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    balance_at_date: Mapped[dict[date, "AccountBalanceSnapshot"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        collection_class=attribute_keyed_dict("date"),
    )

    @classmethod
    def from_fetched(cls: type["Account"], fetched_account: FetchedAccount) -> "Account":
        return cls(name=fetched_account.name)

    def update_balance_at_date(self) -> None:
        daily_totals: dict[date, float] = defaultdict(float)
        for transaction in self.transactions:
            daily_totals[transaction.date] += transaction.amount

        running_balance = self.balance
        for day in sorted(daily_totals, reverse=True):
            if day not in self.balance_at_date:
                self.balance_at_date[day] = AccountBalanceSnapshot(date=day, balance=running_balance)
            running_balance = round(number=running_balance - daily_totals[day], ndigits=2)

    def recompute_balance_at_date(self) -> None:
        # Used after manual edits (balance change, transaction insert/delete)
        self.balance_at_date.clear()
        self.update_balance_at_date()
