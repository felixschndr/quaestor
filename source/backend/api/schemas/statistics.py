from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from source.backend.api.schemas.transaction import TransactionRead
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType

StatisticsDirection = Literal["INCOMING", "OUTGOING"]
StatisticsLinked = Literal["linked", "unlinked"]

TransactionCountsGroupBy = Literal["day", "week", "month", "weekday"]


class StatisticsQuery(BaseModel):
    account_ids: list[int] = Field(min_length=1)
    date_from: date | None = None
    date_to: date | None = None
    categories: list[TransactionCategory] = Field(default_factory=list)
    transaction_types: list[TransactionType] = Field(default_factory=list)
    linked: StatisticsLinked | None = None


class DirectionalStatisticsQuery(StatisticsQuery):
    direction: StatisticsDirection = "OUTGOING"


class TransactionCountsQuery(StatisticsQuery):
    group_by: TransactionCountsGroupBy = "day"


class OtherPartyStatisticsQuery(DirectionalStatisticsQuery):
    limit: int = Field(default=15, ge=1, le=100)


class NetWorthQuery(BaseModel):
    account_ids: list[int] = Field(min_length=1)
    date_from: date | None = None
    date_to: date | None = None


class CategorySlice(BaseModel):
    category: TransactionCategory
    total: float


class MonthlyCashflow(BaseModel):
    month: str  # ISO year-month string, e.g. "2026-04"
    income: float
    expenses: float


class MonthlyNetSavings(BaseModel):
    month: str
    net: float
    savings_rate: float  # net / income * 100, clamped to 0.0 when there is no income in the month.


class OtherPartySlice(BaseModel):
    other_party: str
    total: float


class TransactionCountBucket(BaseModel):
    # "day"/"week" → ISO date (weeks keyed by their Monday)
    # "month" → "YYYY-MM"
    # "weekday" → SQLite %w day number ("0" = Sunday, "6" = Saturday)
    bucket: str
    count: int


class DailyNetWorth(BaseModel):
    date: date
    value: float


class NetWorthSummary(BaseModel):
    minimum: float
    average: float
    maximum: float


class NetWorthResponse(BaseModel):
    series: list[DailyNetWorth]
    summary: NetWorthSummary | None = None  # None when the series is empty.


class NetWorthRangeQuery(BaseModel):
    start: date
    end: date
    account_ids: list[int] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_order(self) -> "NetWorthRangeQuery":
        if self.end < self.start:
            raise ValueError("end must be on or after start")
        return self


class AccountRangeChange(BaseModel):
    account_id: int
    balance_at_start: float | None
    balance_at_end: float | None
    difference: float
    transactions: list[TransactionRead]


class NetWorthRangeResponse(BaseModel):
    start: date
    end: date
    accounts: list[AccountRangeChange]
    total_at_start: float
    total_at_end: float
    total_difference: float
