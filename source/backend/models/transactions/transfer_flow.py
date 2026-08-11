from typing import TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base

if TYPE_CHECKING:
    from source.backend.models.transactions.transaction import Transaction


class TransferFlow(Base):
    """A "Geldfluss": a group of transactions that together form one movement of money across accounts.

    Replaces the old 1:1 ``transfer_counterpart_id`` pairing. A flow has two or more member transactions;
    display order is by ``(date, amount)`` ascending (never by ``id`` -- that reflects sync order, not the
    logical order of the money movement).

    The ``before_delete`` listener that detaches members lives on Transaction (see transaction.py), which
    imports both classes, so this module needs no runtime import of Transaction.
    """

    __tablename__ = "transfer_flows"
    id: Mapped[int] = mapped_column(primary_key=True)

    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="flow",
        order_by="(Transaction.date, Transaction.amount)",
    )
