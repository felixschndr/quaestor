from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class AccountGroupAccountRef(BaseModel):
    id: int


class AccountGroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    accounts: list[AccountGroupAccountRef]


class AccountGroupLayoutRead(BaseModel):
    groups: list[AccountGroupRead]
    ungrouped: list[AccountGroupAccountRef]


class AccountGroupLayoutWriteGroup(BaseModel):
    id: int | None = None
    name: Annotated[str, Field(min_length=1, max_length=150)]
    account_ids: list[int]


class AccountGroupLayoutWrite(BaseModel):
    groups: list[AccountGroupLayoutWriteGroup]
    ungrouped: list[int]
