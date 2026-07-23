import enum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.auth.user import User


class NotificationTrigger(str, enum.Enum):
    EXPECTED_TRANSACTION = "expected_transaction"
    TRANSACTION = "transaction"
    BALANCE_THRESHOLD = "balance_threshold"
    CONTRACT_OVERDUE = "contract_overdue"
    UPCOMING_SHORTFALL = "upcoming_shortfall"
    CONTRACT_AMOUNT_INCREASED = "contract_amount_increased"
    DUPLICATE_TRANSACTION = "duplicate_transaction"
    DIGEST = "digest"


class DigestPeriod(str, enum.Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"


DEFAULT_DIGEST_WEEKDAY = 6  # 0=Mon..6=Sun


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

    # Day count whose meaning depends on the trigger:
    # - SHORTFALL_LOOKAHEAD_DAYS for "upcoming_shortfall"
    # - OVERDUE_GRACE_DAYS for "contract_overdue"
    # - DUPLICATE_WINDOW_DAYS for "duplicate_transaction"
    days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    period: Mapped[DigestPeriod | None] = mapped_column(SQLEnum(DigestPeriod), nullable=True)  # for "digest" trigger
    weekday: Mapped[int | None] = mapped_column(Integer, nullable=True)  # for weekly "digest" trigger
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)  # for "balance_threshold" trigger
    direction: Mapped[BalanceDirection | None] = mapped_column(SQLEnum(BalanceDirection), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notification_rules")
