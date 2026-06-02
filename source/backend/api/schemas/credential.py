from datetime import datetime

from pydantic import BaseModel, ConfigDict
from source.backend.api.schemas.account import AccountRead
from source.backend.bank_handlers import BankProvider
from source.backend.services.sync_jobs import JobErrorCode, JobStatus


class CredentialCreate(BaseModel):
    bank: BankProvider
    credentials: dict[str, str]


class CredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bank: BankProvider
    bank_name: str | None = None
    bank_icon: str | None = None
    accounts: list[AccountRead] = []
    last_fetching_timestamp: datetime | None = None
    requires_two_factor_authentication: bool


class CredentialUpdate(BaseModel):
    bank: BankProvider | None = None
    credentials: dict[str, str] | None = None


class SyncJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: str
    credential_id: int
    status: JobStatus
    expires_at: datetime | None = None
    error: str | None = None
    error_code: JobErrorCode | None = None


class TwoFactorCode(BaseModel):
    code: str
