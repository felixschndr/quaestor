import enum
from typing import TYPE_CHECKING

from source.backend.models.base import Base
from sqlalchemy import JSON, Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.user import User


class NotificationTrigger(str, enum.Enum):
    EXPECTED_TRANSACTION = "expected_transaction"
    TRANSACTION = "transaction"
    BALANCE_THRESHOLD = "balance_threshold"


class BalanceDirection(str, enum.Enum):
    BELOW = "below"  # from above to below
    ABOVE = "above"


class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    include_content: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    trigger: Mapped[NotificationTrigger] = mapped_column(SQLEnum(NotificationTrigger))
    account_ids: Mapped[list[int]] = mapped_column(JSON, default=list)

    # "transaction" trigger criteria
    other_party_contains: Mapped[str | None] = mapped_column(String, nullable=True)
    categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    types: Mapped[list[str]] = mapped_column(JSON, default=list)
    min_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_amount: Mapped[float | None] = mapped_column(Float, nullable=True)

    # "balance_threshold" trigger
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    direction: Mapped[BalanceDirection | None] = mapped_column(SQLEnum(BalanceDirection), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notification_rules")
