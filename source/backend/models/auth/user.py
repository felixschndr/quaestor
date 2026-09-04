from itertools import groupby
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.accounts.account_share import (
    AccountShare,
    SharedCredentialView,
    ShareInvitationView,
    SharePermission,
    ShareStatus,
    shared_account_view,
)
from source.backend.models.auth.theme import Theme
from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.accounts.account_group import AccountGroup
    from source.backend.models.auth.api_key import ApiKey
    from source.backend.models.auth.backup_code import BackupCode
    from source.backend.models.auth.session import UserSession
    from source.backend.models.banking.credential import Credential
    from source.backend.models.notifications.notification_log_entry import NotificationLogEntry
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
    show_upcoming_contracts: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

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
    notification_log: Mapped[List["NotificationLogEntry"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    account_groups: Mapped[List["AccountGroup"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="AccountGroup.position",
    )
    account_shares: Mapped[List["AccountShare"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def accepted_shares(self) -> list["AccountShare"]:
        return [share for share in self.account_shares if share.status is ShareStatus.ACCEPTED]

    @property
    def visible_credentials(self) -> list:
        def key(share: "AccountShare") -> int:
            return share.account.credential_id

        shared = sorted(self.accepted_shares, key=key)
        stand_ins = []
        for _, group in groupby(shared, key=key):
            shares = list(group)
            credential = shares[0].account.credential
            permission = (
                SharePermission.READ
                if any(share.permission is SharePermission.READ for share in shares)
                else SharePermission.WRITE
            )
            stand_ins.append(
                SharedCredentialView(
                    id=credential.id,
                    bank=credential.bank,
                    bank_name=credential.bank_name,
                    bank_icon=credential.bank_icon,
                    accounts=[shared_account_view(share) for share in shares],
                    shared_from=credential.user.display_name,
                    share_permission=permission,
                    last_fetching_timestamp=credential.last_fetching_timestamp,
                    requires_two_factor_authentication=credential.requires_two_factor_authentication,
                    sync_enabled=credential.sync_enabled,
                )
            )
        return list(self.credentials) + stand_ins

    @property
    def account_share_invitations(self) -> list[ShareInvitationView]:
        return [
            ShareInvitationView(
                id=share.id,
                credential_id=share.account.credential_id,
                account_name=share.account.display_label,
                bank_name=share.account.credential.bank_name or share.account.credential.bank.value,
                owner_name=share.account.credential.user.display_name,
                permission=share.permission,
            )
            for share in self.account_shares
            if share.status is ShareStatus.PENDING
        ]

    @property
    def balance(self) -> float:
        return sum(
            account.balance * account.balance_factor / 100
            for credential in self.visible_credentials
            for account in credential.accounts
            if not account.is_hidden
        )
