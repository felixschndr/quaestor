import datetime
from typing import TYPE_CHECKING

from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.logging_utils import get_logger
from source.backend.models.base import Base
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from sqlalchemy import Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
        if transaction.category == TransactionCategory.UNKNOWN:
            logger.info(f"No category matched for {transaction}")
        return transaction
