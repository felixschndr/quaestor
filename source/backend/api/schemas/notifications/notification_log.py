from pydantic import BaseModel, ConfigDict

from source.backend.api.schemas.core.common import UtcDatetime


class NotificationLogEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    url: str | None = None
    created_at: UtcDatetime
    read_at: UtcDatetime | None = None
