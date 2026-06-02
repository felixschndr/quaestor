from datetime import datetime
from typing import TYPE_CHECKING

from source.backend.models.base import Base
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.user import User


class TwoFactorChallenge(Base):
    # Short-lived bridge between the password step and the code step of a 2FA login.

    __tablename__ = "two_factor_challenges"
    __repr_exclude__ = frozenset({"token_hash"})

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship()
