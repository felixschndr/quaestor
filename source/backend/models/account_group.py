from typing import TYPE_CHECKING, List

from source.backend.models.base import Base
from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.account import Account
    from source.backend.models.user import User


class AccountGroup(Base):
    __tablename__ = "account_groups"

    # `position` orders the groups within a user. Lower values appear first.
    # The same value may legitimately appear if the client hasn't normalised yet;
    # the API resolves ties by `id` to stay deterministic.
    __table_args__ = (Index("ix_account_groups_user_position", "user_id", "position"),)  # noqa: FKA100

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(length=150))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    user: Mapped["User"] = relationship(back_populates="account_groups")
    accounts: Mapped[List["Account"]] = relationship(
        back_populates="group",
        order_by="Account.position",
    )
