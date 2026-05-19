from datetime import datetime

from pydantic import BaseModel, ConfigDict
from source.backend.api.schemas.account import AccountRead
from source.backend.bank_handlers import BankProvider
from source.backend.services.credential_service import SyncStatus


class CredentialCreate(BaseModel):
    bank: BankProvider
    credentials: dict[str, str]


class CredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bank: BankProvider
    accounts: list[AccountRead] = []
    last_fetching_timestamp: datetime | None = None
    requires_two_factor_authentication: bool


class CredentialUpdate(BaseModel):
    bank: BankProvider | None = None
    credentials: dict[str, str] | None = None


class SyncResponse(BaseModel):
    status: SyncStatus
    challenge_token: str | None = None
    expires_at: datetime | None = None


class TwoFactorConfirm(BaseModel):
    challenge_token: str
    code: str
