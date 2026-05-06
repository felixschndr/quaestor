from datetime import datetime

from pydantic import BaseModel, ConfigDict
from source.bank_handlers import BankProvider


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: float
    timestamp: datetime


class AccountCreate(BaseModel):
    user_id: int
    provider: BankProvider
    username: str
    password: str


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    balance: float
    provider: BankProvider
    username: str
    transactions: list[TransactionRead] = []


class AccountUpdate(BaseModel):
    username: str | None = None
    password: str | None = None


class UserCreate(BaseModel):
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    balance: float
    accounts: list[AccountRead] = []


class UserUpdate(BaseModel):
    name: str | None = None
