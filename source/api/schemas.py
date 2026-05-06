from datetime import datetime

from pydantic import BaseModel, ConfigDict
from source.bank_handlers import BankProvider


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: float
    timestamp: datetime


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    balance: float
    provider: BankProvider
    username: str
    transactions: list[TransactionRead] = []


class AccountCreate(BaseModel):
    user_id: int
    provider: BankProvider
    username: str
    password: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    balance: float
    accounts: list[AccountRead] = []


class UserCreate(BaseModel):
    name: str
