from typing import TYPE_CHECKING, List

from source.backend.models.base import Base
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.credential import Credential
    from source.backend.models.session import UserSession


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    password_hash: Mapped[str] = mapped_column(String)
    admin: Mapped[bool] = mapped_column(default=False)

    credentials: Mapped[List["Credential"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[List["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def balance(self) -> float:
        return sum(account.balance for credential in self.credentials for account in credential.accounts)
