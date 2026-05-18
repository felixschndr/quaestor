from pydantic import BaseModel, ConfigDict
from source.api.schemas.credential import CredentialRead


class UserCreate(BaseModel):
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    admin: bool
    balance: float
    credentials: list[CredentialRead] = []


class UserUpdate(BaseModel):
    name: str | None = None
