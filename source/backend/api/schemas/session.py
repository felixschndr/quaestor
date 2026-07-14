from pydantic import BaseModel

from source.backend.api.schemas.common import UtcDatetime


class SessionRead(BaseModel):
    id: int
    created_at: UtcDatetime
    last_used_at: UtcDatetime
    ip: str | None
    user_agent: str | None
    is_current: bool
