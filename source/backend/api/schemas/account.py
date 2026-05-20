import datetime

from pydantic import BaseModel, ConfigDict
from source.backend.api.schemas.transaction import TransactionRead


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    balance: float


class AccountHistory(BaseModel):
    transactions: list[TransactionRead]
    balance_at_date: dict[datetime.date, float]
    page: int
    page_size: int
    # Total number of distinct transaction days for the account; lets the
    # client know whether there is another page worth requesting.
    total_days: int
