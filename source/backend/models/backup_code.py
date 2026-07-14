from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.user import User


class BackupCode(Base):
    __tablename__ = "backup_codes"
    __repr_exclude__ = frozenset({"code_hash"})

    id: Mapped[int] = mapped_column(primary_key=True)

    # Argon2 hash of a single-use backup code; the row is deleted the moment the code is used, so
    # every existing row is by definition still valid.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    code_hash: Mapped[str] = mapped_column(String)

    user: Mapped["User"] = relationship(back_populates="backup_codes")
