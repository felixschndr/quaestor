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
    external_id: str
    name: str
    balance: float
    transactions: list[TransactionRead] = []


class CredentialCreate(BaseModel):
    user_id: int
    bank: BankProvider
    username: str
    password: str


class CredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bank: BankProvider
    username: str
    accounts: list[AccountRead] = []


class CredentialUpdate(BaseModel):
    bank: BankProvider | None = None
    username: str | None = None
    password: str | None = None


class UserCreate(BaseModel):
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    balance: float
    credentials: list[CredentialRead] = []


class UserUpdate(BaseModel):
    name: str | None = None


class ApplicationSecretCreate(BaseModel):
    name: str
    value: str


class ApplicationSecretRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
