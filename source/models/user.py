from typing import TYPE_CHECKING, List

from source.models.base import Base
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.models.account import Account


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))

    accounts: Mapped[List["Account"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def balance(self) -> float:
        return sum(account.balance for account in self.accounts)
