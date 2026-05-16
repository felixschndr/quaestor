from datetime import datetime
from typing import TYPE_CHECKING, List

from source.bank_handlers import BankHandler, BankProvider, handler_for
from source.models.account import Account
from source.models.base import Base
from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.models.user import User


class Credential(Base):
    __tablename__ = "credentials"
    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    username: Mapped[str] = mapped_column(String)
    password: Mapped[str] = mapped_column(String)
    extra: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    last_fetching_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="credentials")
    accounts: Mapped[List["Account"]] = relationship(back_populates="credential", cascade="all, delete-orphan")

    @property
    def handler(self) -> BankHandler:
        return handler_for(self.bank, self.username, self.password, self.extra)

    def sync(self, handler: BankHandler) -> None:
        by_name = {account.name: account for account in self.accounts}
        with handler.session() as bank:
            for fetched in bank.get_accounts():
                account = by_name.get(fetched.name)
                if account is None:
                    account = Account(name=fetched.name)
                    self.accounts.append(account)
                else:
                    account.name = fetched.name
                account.balance = bank.get_balance(fetched)
        self.last_fetching_timestamp = datetime.now()
