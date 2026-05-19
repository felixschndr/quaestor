import datetime

from pydantic import BaseModel, ConfigDict


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: float
    purpose: str | None
    date: datetime.date
    recipient: str | None


class TransactionPage(BaseModel):
    items: list[TransactionRead]
    page: int
    page_size: int
    total: int
