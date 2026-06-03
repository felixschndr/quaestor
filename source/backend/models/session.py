from datetime import datetime
from typing import TYPE_CHECKING

from source.backend.models.base import Base
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.user import User


class UserSession(Base):
    __tablename__ = "sessions"
    __repr_exclude__ = frozenset({"token_hash"})

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    remember_me: Mapped[bool] = mapped_column(default=False)

    user: Mapped["User"] = relationship(back_populates="sessions")

    def log_label(self) -> str:
        return f"User: {self.user_id} (Session-ID: {self.id})"
