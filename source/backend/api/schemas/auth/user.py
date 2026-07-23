import re
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from source.backend.api.schemas.banking.credential import CredentialRead
from source.backend.models.auth.theme import Theme
from source.backend.services.core import i18n_service

MIN_PASSWORD_LENGTH = 15
PASSWORD_RULES = {
    "lower": (re.compile(r"[a-z]"), "a lowercase letter"),
    "upper": (re.compile(r"[A-Z]"), "an uppercase letter"),
    "digit": (re.compile(r"\d"), "a digit"),
    "symbol": (re.compile(r"[^A-Za-z0-9]"), "a special character"),
}

UserName = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1)]


def _validate_password_complexity(value: str) -> str:
    missing = [description for pattern, description in PASSWORD_RULES.values() if not pattern.search(value)]
    if missing:
        raise ValueError(f"Password must contain at least {', '.join(missing)}")
    return value


def _validate_language(value: str | None) -> str | None:
    if value is None:
        return None
    if not i18n_service.is_supported(value):
        supported = ", ".join(i18n_service.SUPPORTED_LANGUAGES)
        raise ValueError(f"Language {value!r} is not supported (supported: {supported})")
    return value


def _validate_currency(value: str | None) -> str | None:
    if value is None:
        return None
    if not i18n_service.is_supported_currency(value):
        supported = ", ".join(i18n_service.SUPPORTED_CURRENCIES)
        raise ValueError(f"Currency {value!r} is not supported (supported: {supported})")
    return value


class UserCreate(BaseModel):
    user_name: UserName
    display_name: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)
    theme: Theme = Theme.SYSTEM
    language: str | None = None  # None → server default
    currency: str | None = None  # None → server default

    @field_validator("password")
    @classmethod
    def _check_password(cls: type["UserCreate"], value: str) -> str:
        return _validate_password_complexity(value)

    @field_validator("language")
    @classmethod
    def _check_language(cls: type["UserCreate"], value: str | None) -> str | None:
        return _validate_language(value)

    @field_validator("currency")
    @classmethod
    def _check_currency(cls: type["UserCreate"], value: str | None) -> str | None:
        return _validate_currency(value)


class PasswordRule(BaseModel):
    name: str
    regex: str
    description: str


class PasswordRequirements(BaseModel):
    min_length: int
    rules: list[PasswordRule]


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_name: str
    display_name: str
    language: str
    currency: str
    theme: Theme
    two_factor_enabled: bool
    balance: float
    credentials: list[CredentialRead] = []


class UserLogin(BaseModel):
    user_name: UserName
    password: str
    remember_me: bool = False


class UserUpdate(BaseModel):
    user_name: UserName | None = None
    display_name: str | None = None
    language: str | None = None
    currency: str | None = None
    theme: Theme | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=MIN_PASSWORD_LENGTH)

    @field_validator("new_password")
    @classmethod
    def _check_new_password(cls: type["UserUpdate"], value: str | None) -> str | None:
        return _validate_password_complexity(value) if value is not None else None

    @field_validator("language")
    @classmethod
    def _check_language(cls: type["UserUpdate"], value: str | None) -> str | None:
        return _validate_language(value)

    @field_validator("currency")
    @classmethod
    def _check_currency(cls: type["UserUpdate"], value: str | None) -> str | None:
        return _validate_currency(value)

    @model_validator(mode="after")
    def _password_change_requires_current(self) -> "UserUpdate":
        if self.new_password is not None and not self.current_password:
            raise ValueError("Changing the password requires the current password")
        return self
