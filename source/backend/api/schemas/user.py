import re
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_validator
from source.backend.api.schemas.credential import CredentialRead

if TYPE_CHECKING:
    from pydantic.v1.main import ModelMetaclass

_PASSWORD_RULES = [
    (re.compile(r"[a-z]"), "a lowercase letter"),
    (re.compile(r"[A-Z]"), "an uppercase letter"),
    (re.compile(r"\d"), "a digit"),
    (re.compile(r"[^A-Za-z0-9]"), "a special character"),
]


class UserCreate(BaseModel):
    user_name: str
    display_name: str
    password: str = Field(min_length=15)

    @field_validator("password")
    @classmethod
    def _validate_password_complexity(cls: ModelMetaclass, value: str) -> str:
        missing = [description for pattern, description in _PASSWORD_RULES if not pattern.search(value)]
        if missing:
            raise ValueError(f"Password must contain at least {', '.join(missing)}")
        return value


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    display_name: str
    admin: bool
    balance: float
    credentials: list[CredentialRead] = []


class UserLogin(BaseModel):
    user_name: str
    password: str


class UserUpdate(BaseModel):
    display_name: str
