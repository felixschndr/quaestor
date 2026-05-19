from datetime import datetime
from typing import TYPE_CHECKING, List

from source.backend.bank_handlers import BankHandler, BankProvider, handler_for
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.base import Base
from sqlalchemy import JSON, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

logger = get_logger(__name__)

if TYPE_CHECKING:
    from source.backend.models.user import User


class Credential(Base):
    __tablename__ = "credentials"
    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[BankProvider] = mapped_column(SQLEnum(BankProvider))
    username: Mapped[str] = mapped_column(String)
    password: Mapped[str] = mapped_column(String)
    extra: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)

    session_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_fetching_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requires_two_factor_authentication: Mapped[bool] = mapped_column(default=False)

    user: Mapped["User"] = relationship(back_populates="credentials")
    accounts: Mapped[List["Account"]] = relationship(back_populates="credential", cascade="all, delete-orphan")

    @property
    def handler(self) -> BankHandler:
        return handler_for(provider=self.bank, username=self.username, password=self.password, extra=self.extra)

    def sync(self, handler: BankHandler) -> None:
        by_name = {account.name: account for account in self.accounts}
        created_accounts = 0
        updated_accounts = 0
        with handler.session() as bank:
            for fetched_account in bank.get_accounts():
                account = by_name.get(fetched_account.name)
                if account is None:
                    account = Account(name=fetched_account.name)
                    self.accounts.append(account)
                    created_accounts += 1
                elif account.name != fetched_account.name:
                    account.name = fetched_account.name
                    updated_accounts += 1
                account.balance = bank.get_balance(fetched_account)
        self.last_fetching_timestamp = datetime.now()
        logger.info(
            f"Credential {self.id}: {created_accounts} account(s) created, {updated_accounts} account(s) updated"
        )
