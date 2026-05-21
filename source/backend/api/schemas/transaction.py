import datetime

from pydantic import BaseModel, ConfigDict
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
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
