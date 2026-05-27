from collections import defaultdict
from datetime import date
from typing import TYPE_CHECKING, List

from source.backend.bank_handlers.base import FetchedAccount
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from source.backend.models.account_group import (  # noqa: F401 — registers FK target table
    AccountGroup,
)
from source.backend.models.base import Base
from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import (
    Mapped,
    attribute_keyed_dict,
    mapped_column,
    object_session,
    relationship,
)

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

    # User-defined grouping for the overview. NULL = "ungrouped" (rendered in a
    # default bucket). `position` orders accounts within their group OR within
    # the ungrouped bucket.
    group_id: Mapped[int | None] = mapped_column(ForeignKey("account_groups.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    credential: Mapped["Credential"] = relationship(back_populates="accounts")
    group: Mapped["AccountGroup | None"] = relationship(back_populates="accounts")
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
        today = date.today()
        daily_totals: dict[date, float] = defaultdict(float)
        for transaction in self.transactions:
            if transaction.date > today:  # Future-dated transactions haven't moved money yet
                continue
            daily_totals[transaction.date] += transaction.amount

        running_balance = self.balance
        for day in sorted(daily_totals, reverse=True):
            if day not in self.balance_at_date:
                self.balance_at_date[day] = AccountBalanceSnapshot(date=day, balance=running_balance)
            running_balance = round(number=running_balance - daily_totals[day], ndigits=2)

    def recompute_balances_at_date(self) -> None:
        self.balance_at_date.clear()
        session = object_session(self)
        if session is not None:
            session.flush()
        self.update_balance_at_date()
