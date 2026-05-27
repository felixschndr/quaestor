from typing import TYPE_CHECKING, List

from source.backend.models.base import Base
from source.backend.models.theme import Theme
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.account_group import AccountGroup
    from source.backend.models.credential import Credential
    from source.backend.models.session import UserSession


class User(Base):
    __tablename__ = "users"
    __repr_exclude__ = frozenset({"password_hash"})

    id: Mapped[int] = mapped_column(primary_key=True)
    user_name: Mapped[str] = mapped_column(String(length=100), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String)
    language: Mapped[str] = mapped_column(String(length=10), default="en", server_default="en")
    theme: Mapped[Theme] = mapped_column(SQLEnum(Theme), default=Theme.SYSTEM, server_default=Theme.SYSTEM.value)

    credentials: Mapped[List["Credential"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[List["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    account_groups: Mapped[List["AccountGroup"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="AccountGroup.position",
    )

    @property
    def balance(self) -> float:
        return sum(
            account.balance * account.balance_factor / 100
            for credential in self.credentials
            for account in credential.accounts
        )
