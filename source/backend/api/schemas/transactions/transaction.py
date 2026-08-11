import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType

StatisticsLinked = Literal["linked", "unlinked", "none"]
HasAttachment = Literal["with", "without", "none"]


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    amount: float
    purpose: str | None
    date: datetime.date
    other_party: str | None
    transaction_type: TransactionType | None
    category: TransactionCategory
    note: str | None
    pending: bool
    contract_id: int | None = None

    @staticmethod
    def flip_depot_signs(reads: "list[TransactionRead]", market_valued_account_ids: set[int]) -> None:
        # On a depot the balance is the market value of holdings, so a trade reads by how it moves holdings: a buy
        # raises them (+), a sell lowers them (−). Bank data stores the cash convention (buy −, sell +), so present
        # those two flipped for market-valued accounts. Amounts stay stored raw; this is display-only.
        for read in reads:
            if read.account_id in market_valued_account_ids and read.transaction_type in (
                TransactionType.BUY,
                TransactionType.SELL,
            ):
                read.amount = -read.amount


class TransactionDetailRead(TransactionRead):
    flow_members: list[TransactionRead] = Field(default_factory=list)


class TransactionUpdate(BaseModel):
    note: str | None = None
    category: TransactionCategory | None = None
    amount: float | None = None
    date: datetime.date | None = None
    purpose: str | None = None
    other_party: str | None = None
    transaction_type: TransactionType | None = None


class TransactionCreate(BaseModel):
    amount: float
    date: datetime.date
    purpose: str | None = None
    other_party: str | None = None
    transaction_type: TransactionType | None = None
    category: TransactionCategory | None = None
    note: str | None = None


class TransferLinkCreate(BaseModel):
    counterpart_account_id: int
    counterpart_transaction_id: int


class TransactionSearchQuery(BaseModel):
    account_ids: list[int] = Field(min_length=1)
    text: str | None = None
    amount_from: float | None = None
    amount_to: float | None = None
    date_from: datetime.date | None = None
    date_to: datetime.date | None = None
    transaction_types: list[TransactionType] = Field(default_factory=list)
    categories: list[TransactionCategory] = Field(default_factory=list)
    note: str | None = None
    linked: StatisticsLinked | None = None
    has_attachment: HasAttachment | None = None

    def to_filter_parameters(self) -> dict:
        data = self.model_dump(exclude={"account_ids"})
        return {key: value for key, value in data.items() if value is not None and value != []}
