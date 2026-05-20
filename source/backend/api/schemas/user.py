import re
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from source.backend.api.schemas.credential import CredentialRead

if TYPE_CHECKING:
    from pydantic.v1.main import ModelMetaclass

MIN_PASSWORD_LENGTH = 15
PASSWORD_RULES = {
    "lower": (re.compile(r"[a-z]"), "a lowercase letter"),
    "upper": (re.compile(r"[A-Z]"), "an uppercase letter"),
    "digit": (re.compile(r"\d"), "a digit"),
    "symbol": (re.compile(r"[^A-Za-z0-9]"), "a special character"),
}


def _validate_password_complexity(value: str) -> str:
    missing = [description for pattern, description in PASSWORD_RULES.values() if not pattern.search(value)]
    if missing:
        raise ValueError(f"Password must contain at least {', '.join(missing)}")
    return value


class UserCreate(BaseModel):
    user_name: str
    display_name: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("password")
    @classmethod
    def _check_password(cls: "ModelMetaclass", value: str) -> str:
        return _validate_password_complexity(value)


class PasswordRule(BaseModel):
    name: str
    regex: str
    description: str


class PasswordRequirements(BaseModel):
    min_length: int
    rules: list[PasswordRule]


class RegistrationAllowed(BaseModel):
    allowed: bool


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    display_name: str
    balance: float
    credentials: list[CredentialRead] = []


class UserLogin(BaseModel):
    user_name: str
    password: str
    remember_me: bool = False


class UserUpdate(BaseModel):
    display_name: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=MIN_PASSWORD_LENGTH)

    @field_validator("new_password")
    @classmethod
    def _check_new_password(cls: "ModelMetaclass", value: str | None) -> str | None:
        return _validate_password_complexity(value) if value is not None else None

    @model_validator(mode="after")
    def _password_change_requires_current(self) -> "UserUpdate":
        if self.new_password is not None and not self.current_password:
            raise ValueError("Changing the password requires the current password")
        return self
