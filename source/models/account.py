from typing import TYPE_CHECKING, Any, List

from source.bank_handlers import BankProvider
from source.models.base import Base
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.models.transaction import Transaction
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

    user: Mapped["User"] = relationship(back_populates="accounts")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")

    def __init__(self, **kw: Any) -> None:
        kw.setdefault("balance", 0.0)
        super().__init__(**kw)
