from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.auth.theme import Theme
from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.accounts.account_group import AccountGroup
    from source.backend.models.auth.api_key import ApiKey
    from source.backend.models.auth.backup_code import BackupCode
    from source.backend.models.auth.session import UserSession
    from source.backend.models.banking.credential import Credential
    from source.backend.models.notifications.notification_rule import NotificationRule
    from source.backend.models.notifications.push_subscription import PushSubscription


class User(Base):
    __tablename__ = "users"
    __repr_exclude__ = frozenset({"password_hash", "two_factor_secret"})

    id: Mapped[int] = mapped_column(primary_key=True)
    user_name: Mapped[str] = mapped_column(String(length=100), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String)
    language: Mapped[str] = mapped_column(String(length=10), default="en", server_default="en")
    currency: Mapped[str] = mapped_column(String(length=3), default="EUR", server_default="EUR")
    theme: Mapped[Theme] = mapped_column(SQLEnum(Theme), default=Theme.SYSTEM, server_default=Theme.SYSTEM.value)
    # Cannot be hashed because verifying a code requires the original secret.
    two_factor_secret: Mapped[str | None] = mapped_column(String, nullable=True)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    credentials: Mapped[List["Credential"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[List["UserSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    api_keys: Mapped[List["ApiKey"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    backup_codes: Mapped[List["BackupCode"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    push_subscriptions: Mapped[List["PushSubscription"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    notification_rules: Mapped[List["NotificationRule"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
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
            if not account.is_hidden
        )
