from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, field_validator
from source.backend.api.schemas.common import UtcDatetime

if TYPE_CHECKING:
    from pydantic.v1.main import ModelMetaclass

MAX_NAME_LENGTH = 100


class ApiKeyCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _normalize_name(cls: "ModelMetaclass", value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must not be empty")
        if len(normalized) > MAX_NAME_LENGTH:
            raise ValueError(f"name must be at most {MAX_NAME_LENGTH} characters")
        return normalized


class ApiKeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prefix: str
    created_at: UtcDatetime
    last_used_at: UtcDatetime | None


class ApiKeyCreated(ApiKeyRead):
    token: str
