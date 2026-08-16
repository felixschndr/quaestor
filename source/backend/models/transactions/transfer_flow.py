from typing import TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.transactions.transaction import Transaction


class TransferFlow(Base):
    __tablename__ = "transfer_flows"
    id: Mapped[int] = mapped_column(primary_key=True)

    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="flow",
        order_by="(Transaction.date, Transaction.amount)",
        passive_deletes=True,
    )
