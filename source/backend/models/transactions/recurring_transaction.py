import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String, event, update
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base
from source.backend.models.transactions.recurrence_frequency import RecurrenceFrequency
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType

if TYPE_CHECKING:
    from sqlalchemy import Connection
    from sqlalchemy.orm import Mapper

    from source.backend.models.accounts.account import Account


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"
    id: Mapped[int] = mapped_column(primary_key=True)

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)

    amount: Mapped[float] = mapped_column(Float)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    other_party: Mapped[str | None] = mapped_column(String, nullable=True)
    transaction_type: Mapped[TransactionType | None] = mapped_column(SQLEnum(TransactionType), nullable=True)
    category: Mapped[TransactionCategory | None] = mapped_column(SQLEnum(TransactionCategory), nullable=True)
    note: Mapped[str | None] = mapped_column(String, nullable=True)

    frequency: Mapped[RecurrenceFrequency] = mapped_column(SQLEnum(RecurrenceFrequency))
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Mon=0

    next_run_date: Mapped[datetime.date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))

    account: Mapped["Account"] = relationship(back_populates="recurring_transactions")


@event.listens_for(target=RecurringTransaction, identifier="before_delete")
def _clear_booked_transaction_links(_mapper: "Mapper", connection: "Connection", target: RecurringTransaction) -> None:
    connection.execute(
        update(Transaction)
        .where(Transaction.recurring_transaction_id == target.id)
        .values(recurring_transaction_id=None)
    )
