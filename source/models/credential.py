from datetime import datetime
from typing import TYPE_CHECKING, List

from source.bank_handlers import BankHandler, BankProvider, handler_for
from source.models.account import Account
from source.models.base import Base
from source.models.types import EncryptedString
from sqlalchemy import DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.models.user import User


class Credential(Base):
    __tablename__ = "credentials"
    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    username: Mapped[str] = mapped_column(EncryptedString)
    password: Mapped[str] = mapped_column(EncryptedString)
    last_fetching_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="credentials")
    accounts: Mapped[List["Account"]] = relationship(back_populates="credential", cascade="all, delete-orphan")

    @property
    def handler(self) -> BankHandler:
        return handler_for(self.bank, self.username, self.password)

    def sync(self) -> None:
        """Discover/refresh the accounts reachable with this credential."""
        handler = self.handler
        by_external_id = {account.external_id: account for account in self.accounts}
        for fetched in handler.get_accounts():
            account = by_external_id.get(fetched.external_id)
            if account is None:
                account = Account(external_id=fetched.external_id, name=fetched.name)
                self.accounts.append(account)
            else:
                account.name = fetched.name
            account.balance = handler.get_balance(fetched)
        self.last_fetching_timestamp = datetime.now()
