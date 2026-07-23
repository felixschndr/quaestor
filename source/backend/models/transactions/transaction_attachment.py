import datetime
from typing import TYPE_CHECKING, ClassVar

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.transactions.transaction import Transaction


class TransactionAttachment(Base):
    __tablename__ = "transaction_attachments"
    __repr_exclude__: ClassVar[frozenset[str]] = frozenset({"data"})

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String)
    content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size: Mapped[int] = mapped_column(Integer)
    # Deferred so listing attachments (metadata only) never pulls the megabytes off disk.
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))

    transaction: Mapped["Transaction"] = relationship(back_populates="attachments")
