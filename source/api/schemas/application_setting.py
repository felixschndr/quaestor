from pydantic import BaseModel, ConfigDict


class ApplicationSettingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    value: str


class ApplicationSettingUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    value: str
