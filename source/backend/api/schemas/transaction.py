import datetime

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


class TransactionUpdate(BaseModel):
    note: str | None = None
    category: TransactionCategory | None = None


class TransactionCreate(BaseModel):
    amount: float
    date: datetime.date
    purpose: str | None = None
    other_party: str | None = None
    transaction_type: TransactionType | None = None
    category: TransactionCategory | None = None
    note: str | None = None


class TransactionFilter(BaseModel):
    text: str | None = None
    amount_from: float | None = None
    amount_to: float | None = None
    date_from: datetime.date | None = None
    date_to: datetime.date | None = None
    transaction_type: TransactionType | None = None
    category: TransactionCategory | None = None
    note: str | None = None

    def to_filter_parameters(self) -> dict:
        return {key: value for key, value in self.model_dump().items() if value is not None}


class TransactionSearchQuery(TransactionFilter):
    account_ids: list[int] = Field(min_length=1)

    def to_filter_parameters(self) -> dict:
        data = self.model_dump(exclude={"account_ids"})
        return {key: value for key, value in data.items() if value is not None}
