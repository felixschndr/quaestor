from pydantic import BaseModel, ConfigDict, Field
from source.bank_handlers import BankProvider


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: str
    name: str
    balance: float


class CredentialCreate(BaseModel):
    user_id: int
    bank: BankProvider
    username: str
    password: str
    extra: dict[str, str] = Field(default_factory=dict)


class CredentialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bank: BankProvider
    username: str
    accounts: list[AccountRead] = []


class CredentialUpdate(BaseModel):
    bank: BankProvider | None = None
    username: str | None = None
    password: str | None = None


class UserCreate(BaseModel):
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    balance: float
    credentials: list[CredentialRead] = []


class UserUpdate(BaseModel):
    name: str | None = None


class ApplicationSecretRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ApplicationSecretUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    value: str
