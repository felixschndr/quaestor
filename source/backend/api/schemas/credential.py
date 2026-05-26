from datetime import datetime

from pydantic import BaseModel, ConfigDict
from source.backend.api.schemas.account import AccountRead
from source.backend.bank_handlers import BankProvider
from source.backend.services.sync_jobs import JobStatus


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


class SyncJobRead(BaseModel):
    job_id: str
    status: JobStatus
    expires_at: datetime | None = None
    error: str | None = None


class TwoFactorCode(BaseModel):
    code: str
