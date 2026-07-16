from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from source.backend.api.schemas.core.common import UtcDatetime


class ApiKeyCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ApiKeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prefix: str
    created_at: UtcDatetime
    last_used_at: UtcDatetime | None


class ApiKeyCreated(ApiKeyRead):
    token: str
