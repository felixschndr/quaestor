from datetime import date
from typing import Literal

from pydantic import BaseModel, Field
from source.backend.api.schemas.transaction import TransactionRead
from source.backend.models.transaction_category import TransactionCategory

StatisticsDirection = Literal["INCOMING", "OUTGOING"]


class StatisticsQuery(BaseModel):
    account_ids: list[int] = Field(min_length=1)
    date_from: date | None = None
    date_to: date | None = None
    categories: list[TransactionCategory] = Field(default_factory=list)


class DirectionalStatisticsQuery(StatisticsQuery):
    direction: StatisticsDirection = "OUTGOING"


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


class NetWorthDayQuery(BaseModel):
    day: date
    account_ids: list[int] = Field(min_length=1)


class DayAccountChange(BaseModel):
    account_id: int
    balance_at_end_of_day_before: float | None
    balance_at_end_of_current_day: float | None
    difference: float
    transactions: list[TransactionRead]


class NetWorthDayResponse(BaseModel):
    date: date
    accounts: list[DayAccountChange]
    total_at_end_of_day_before: float
    total_at_end_of_current_day: float
    total_difference: float
