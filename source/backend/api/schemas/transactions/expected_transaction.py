from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


class ExpectedTransactionWrite(BaseModel):
    amount: float
    other_party: str | None = None
    note: str | None = None
    match_tolerance_percent: Literal[0, 5, 10, 15, 20] = 0

    @field_validator("amount")
    @classmethod
    def _amount_not_zero(cls: type["ExpectedTransactionWrite"], value: float) -> float:
        if value == 0:
            raise ValueError("amount must not be zero")
        return value


class ExpectedTransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    amount: float
    other_party: str | None
    note: str | None
    match_tolerance_percent: int | None
