import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field
from source.backend.api.schemas.transaction import TransactionRead


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str | None
    balance: float
    balance_factor: int
    is_hidden: bool


class AccountCreate(BaseModel):  # Only allowed for manual accounts
    credential_id: int
    name: Annotated[str, Field(min_length=1, max_length=120)]
    display_name: Annotated[str, Field(max_length=150)] | None = None
    balance: float = 0.0
    balance_factor: Annotated[int, Field(ge=0, le=100)] = 100


class AccountUpdate(BaseModel):
    balance_factor: Annotated[int, Field(ge=0, le=100)] | None = None
    display_name: Annotated[str, Field(max_length=150)] | None = None
    is_hidden: bool | None = None

    balance: float | None = None  # Only allowed for manual accounts


class AccountHistory(BaseModel):
    transactions: list[TransactionRead]
    balance_at_date: dict[datetime.date, float]
    page: int
    page_size: int
    # Total number of distinct transaction days for the account
    # lets the client know whether there is another page worth requesting
    total_days: int
