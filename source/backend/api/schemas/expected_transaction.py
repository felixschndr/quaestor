from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, field_validator

if TYPE_CHECKING:
    from pydantic.v1.main import ModelMetaclass

ALLOWED_TOLERANCES = frozenset({0, 5, 10, 15, 20})


class _ExpectedTransactionFields(BaseModel):
    amount: float
    other_party: str | None = None
    note: str | None = None
    match_tolerance_percent: int = 0

    @field_validator("amount")
    @classmethod
    def _amount_not_zero(cls: "ModelMetaclass", value: float) -> float:
        if value == 0:
            raise ValueError("amount must not be zero")
        return value

    @field_validator("match_tolerance_percent")
    @classmethod
    def _tolerance_in_steps(cls: "ModelMetaclass", value: int) -> int:
        if value not in ALLOWED_TOLERANCES:
            raise ValueError(f"match_tolerance_percent must be one of {sorted(ALLOWED_TOLERANCES)}")
        return value


class ExpectedTransactionCreate(_ExpectedTransactionFields):
    pass


class ExpectedTransactionUpdate(_ExpectedTransactionFields):
    pass


class ExpectedTransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    amount: float
    other_party: str | None
    note: str | None
    match_tolerance_percent: int | None
