from datetime import datetime

from pydantic import BaseModel, ConfigDict
from source.bank_handlers import BankProvider
from source.services.credential_service import SyncStatus


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    balance: float


class CredentialCreate(BaseModel):
    # Handler-specific fields (="extra"s) are sent flat alongside username/password
    model_config = ConfigDict(extra="allow")

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


class SyncResponse(BaseModel):
    status: SyncStatus
    challenge_token: str | None = None
    expires_at: datetime | None = None


class TwoFactorConfirm(BaseModel):
    challenge_token: str
    code: str


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


class ApplicationSecretRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ApplicationSecretUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    value: str
