import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType


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
    transfer_counterpart_id: int | None
    pending: bool
    contract_id: int | None = None


class TransactionDetailRead(TransactionRead):
    transfer_counterpart: TransactionRead | None = None


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


class TransactionFilter(BaseModel):
    text: str | None = None
    amount_from: float | None = None
    amount_to: float | None = None
    date_from: datetime.date | None = None
    date_to: datetime.date | None = None
    transaction_types: list[TransactionType] = Field(default_factory=list)
    categories: list[TransactionCategory] = Field(default_factory=list)
    note: str | None = None
    # "linked" = transaction is part of a transfer (has a counterpart),
    # "unlinked" = no counterpart. Missing means "no filter".
    linked: Literal["linked", "unlinked"] | None = None

    def to_filter_parameters(self) -> dict:
        return {key: value for key, value in self.model_dump().items() if value is not None and value != []}


class TransactionSearchQuery(TransactionFilter):
    account_ids: list[int] = Field(min_length=1)

    def to_filter_parameters(self) -> dict:
        data = self.model_dump(exclude={"account_ids"})
        return {key: value for key, value in data.items() if value is not None and value != []}
