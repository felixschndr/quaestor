from pydantic import BaseModel, ConfigDict


class ApplicationSecretRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ApplicationSecretUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    value: str
