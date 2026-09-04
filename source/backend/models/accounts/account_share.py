import enum
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.bank_handlers import BankProvider
from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.accounts.account import Account
    from source.backend.models.accounts.account_group import AccountGroup
    from source.backend.models.auth.user import User


class SharePermission(str, enum.Enum):
    READ = "read"
    WRITE = "write"


class ShareStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"


class AccountShare(Base):
    __tablename__ = "account_shares"
    __table_args__ = (UniqueConstraint("account_id", "user_id", name="uq_account_shares_account_user"),)  # noqa: FKA100

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    permission: Mapped[SharePermission] = mapped_column(SQLEnum(SharePermission))
    status: Mapped[ShareStatus] = mapped_column(SQLEnum(ShareStatus), default=ShareStatus.PENDING)
    display_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    balance_factor: Mapped[float] = mapped_column(Float, default=100.0, server_default="100.0")
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    include_by_default: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    group_id: Mapped[int | None] = mapped_column(ForeignKey("account_groups.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    account: Mapped["Account"] = relationship(back_populates="shares")
    user: Mapped["User"] = relationship(back_populates="account_shares")
    group: Mapped["AccountGroup | None"] = relationship(back_populates="shares")


@dataclass(frozen=True)
class SharedAccountView:
    id: int
    name: str
    display_name: str | None
    balance: float
    balance_factor: float
    is_hidden: bool
    include_by_default: bool
    is_market_valued: bool


@dataclass(frozen=True)
class SharedCredentialView:
    id: int
    bank: BankProvider
    bank_name: str | None
    bank_icon: str | None
    accounts: List[SharedAccountView]
    shared_from: str
    share_permission: SharePermission
    last_fetching_timestamp: datetime | None
    requires_two_factor_authentication: bool
    sync_enabled: bool


@dataclass(frozen=True)
class ShareInvitationView:
    id: int
    credential_id: int
    account_name: str
    bank_name: str
    owner_name: str
    permission: SharePermission


def shared_account_view(share: AccountShare) -> SharedAccountView:
    account = share.account
    return SharedAccountView(
        id=account.id,
        name=account.name,
        display_name=share.display_name,
        balance=account.balance,
        balance_factor=share.balance_factor,
        is_hidden=share.is_hidden,
        include_by_default=share.include_by_default,
        is_market_valued=account.is_market_valued,
    )
