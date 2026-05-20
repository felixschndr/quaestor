from datetime import datetime

from pydantic import BaseModel


class SessionRead(BaseModel):
    id: int
    created_at: datetime
    last_used_at: datetime
    ip: str | None
    user_agent: str | None
    is_current: bool
