import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String, event, update
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.logging_utils import get_logger
from source.backend.models.base import Base
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType

if TYPE_CHECKING:
    from sqlalchemy import Connection
    from sqlalchemy.orm import Mapper

    from source.backend.models.accounts.account import Account
    from source.backend.models.contracts.contract import Contract

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

    pending: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    # Stable per-account transaction id from the bank, Null for banks that don't provide one
    # NOT globally unique (only unique within one account)
    bank_reference: Mapped[str | None] = mapped_column(String, nullable=True)

    expected: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    match_tolerance_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)

    transfer_counterpart_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    transfer_original_type: Mapped[TransactionType | None] = mapped_column(SQLEnum(TransactionType), nullable=True)
    transfer_relink_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    recurring_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_transactions.id", ondelete="SET NULL"), nullable=True
    )

    contract_id: Mapped[int | None] = mapped_column(
        ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    contract_assignment: Mapped[ContractAssignment | None] = mapped_column(SQLEnum(ContractAssignment), nullable=True)

    transfer_counterpart: Mapped["Transaction | None"] = relationship(
        "Transaction",
        remote_side=[id],
        foreign_keys=[transfer_counterpart_id],
        uselist=False,
        viewonly=True,
    )

    account: Mapped["Account"] = relationship(back_populates="transactions")
    contract: Mapped["Contract | None"] = relationship(back_populates="transactions", foreign_keys=[contract_id])

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
            pending=fetched_transaction.pending,
            bank_reference=fetched_transaction.bank_reference,
        )
        return transaction


@event.listens_for(target=Transaction, identifier="before_delete")
def _clear_transfer_counterpart_links(_mapper: "Mapper", connection: "Connection", target: Transaction) -> None:
    # SQLite doesn't enforce the ON DELETE SET NULL (foreign keys are off), so emulate it
    connection.execute(
        update(Transaction).where(Transaction.transfer_counterpart_id == target.id).values(transfer_counterpart_id=None)
    )
