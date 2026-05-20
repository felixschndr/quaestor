from typing import TYPE_CHECKING, List

from source.backend.bank_handlers.base import FetchedAccount
from source.backend.models.base import Base
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.credential import Credential
    from source.backend.models.transaction import Transaction


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)

    credential_id: Mapped[int] = mapped_column(ForeignKey("credentials.id"))
    name: Mapped[str] = mapped_column(String(120))
    balance: Mapped[float] = mapped_column(Float, default=0.0)

    credential: Mapped["Credential"] = relationship(back_populates="accounts")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")

    @classmethod
    def from_fetched(cls: type["Account"], fetched_account: FetchedAccount) -> "Account":
        return cls(name=fetched_account.name)
