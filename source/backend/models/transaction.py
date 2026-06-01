import datetime
from typing import TYPE_CHECKING

from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.logging_utils import get_logger
from source.backend.models.base import Base
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from sqlalchemy import Connection, Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, String, event, update
from sqlalchemy.orm import Mapped, Mapper, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.account import Account

logger = get_logger(__name__)


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    amount: Mapped[float] = mapped_column(Float)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    date: Mapped[datetime.date] = mapped_column(Date)
    other_party: Mapped[str | None] = mapped_column(String, nullable=True)
    transaction_type: Mapped[TransactionType | None] = mapped_column(SQLEnum(TransactionType), nullable=True)
    category: Mapped[TransactionCategory] = mapped_column(
        SQLEnum(TransactionCategory),
        default=TransactionCategory.UNKNOWN,
        server_default=TransactionCategory.UNKNOWN.value,
    )
    note: Mapped[str | None] = mapped_column(String, nullable=True)

    transfer_counterpart_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, unique=True
    )

    account: Mapped["Account"] = relationship(back_populates="transactions")

    FIELDS_THAT_ARE_ONLY_EDITABLE_ON_MANUAL_ACCOUNTS = frozenset(
        {"amount", "date", "purpose", "other_party", "transaction_type"}
    )

    @classmethod
    def from_fetched(cls: type["Transaction"], fetched_transaction: FetchedTransaction) -> "Transaction":
        transaction = cls(
            amount=fetched_transaction.amount,
            purpose=fetched_transaction.purpose,
            date=fetched_transaction.date,
            other_party=fetched_transaction.other_party,
            transaction_type=fetched_transaction.transaction_type,
            category=TransactionCategory.from_transaction(transaction=fetched_transaction),
        )
        return transaction


@event.listens_for(target=Transaction, identifier="before_delete")
def _clear_transfer_counterpart_links(_mapper: Mapper, connection: Connection, target: Transaction) -> None:
    # SQLite doesn't enforce the ON DELETE SET NULL (foreign keys are off, and the migration only
    # adds a column + unique index, not a real FK constraint), so emulate it: when a transaction is
    # deleted, null out the other leg that still references it. Covers both manual deletes and the
    # account/credential delete cascade.
    connection.execute(
        update(Transaction).where(Transaction.transfer_counterpart_id == target.id).values(transfer_counterpart_id=None)
    )
