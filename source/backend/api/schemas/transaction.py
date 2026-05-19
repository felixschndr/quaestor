import datetime

from pydantic import BaseModel, ConfigDict
from pytr.event import PPEventType


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: float
    purpose: str | None
    date: datetime.date
    other_party: str | None
    portfolio_transaction_type: PPEventType | None


class TransactionPage(BaseModel):
    items: list[TransactionRead]
    page: int
    page_size: int
    total: int
