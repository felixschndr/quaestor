from pydantic import BaseModel, ConfigDict

from source.backend.api.schemas.accounts.account import AccountRead
from source.backend.api.schemas.core.common import UtcDatetime
from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import JobErrorCode
from source.backend.models.accounts.account_share import SharePermission
from source.backend.services.banking.sync_jobs import JobStatus


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
    last_successful_sync_timestamp: UtcDatetime | None = None
    requires_two_factor_authentication: bool
    sync_enabled: bool
    last_sync_error: str | None = None
    last_sync_error_code: JobErrorCode | None = None
    shared_from: str | None = None
    share_permission: SharePermission | None = None


class CredentialUpdate(BaseModel):
    sync_enabled: bool | None = None


class SyncJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: str
    credential_id: int
    status: JobStatus
    expires_at: UtcDatetime | None = None
    error: str | None = None
    error_code: JobErrorCode | None = None
    authorization_url: str | None = None
    device_code: str | None = None

    @classmethod
    def for_viewer(cls: type["SyncJobRead"], job: object, *, owned: bool) -> "SyncJobRead":
        # A job as the requesting user may see it.
        # Someone syncing a credential shared with them gets the status but none of the owner's diagnostics
        read = cls.model_validate(job)
        if not owned:
            read.error = None
            read.authorization_url = None
            read.device_code = None
        return read


class TwoFactorCode(BaseModel):
    code: str
