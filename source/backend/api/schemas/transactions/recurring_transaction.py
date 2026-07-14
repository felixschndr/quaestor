import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from source.backend.models.transactions.recurrence_frequency import RecurrenceFrequency
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType


class _RecurringTransactionFields(BaseModel):
    amount: float
    purpose: str | None = None
    other_party: str | None = None
    transaction_type: TransactionType | None = None
    category: TransactionCategory | None = None
    note: str | None = None

    frequency: RecurrenceFrequency
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    day_of_week: int | None = Field(default=None, ge=0, le=6)

    @model_validator(mode="after")
    def _check_schedule(self) -> "_RecurringTransactionFields":
        if self.frequency == RecurrenceFrequency.MONTHLY:
            if self.day_of_month is None:
                raise ValueError(f"day_of_month is required for a {RecurrenceFrequency.MONTHLY.value} recurrence")
            if self.day_of_week is not None:
                raise ValueError(f"day_of_week must be omitted for a {RecurrenceFrequency.MONTHLY.value} recurrence")
        else:
            if self.day_of_week is None:
                raise ValueError(f"day_of_week is required for a {RecurrenceFrequency.WEEKLY.value} recurrence")
            if self.day_of_month is not None:
                raise ValueError(f"day_of_month must be omitted for a {RecurrenceFrequency.WEEKLY.value} recurrence")
        return self


class RecurringTransactionCreate(_RecurringTransactionFields):
    book_immediately: bool = False


class RecurringTransactionUpdate(_RecurringTransactionFields):
    pass


class RecurringTransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    amount: float
    purpose: str | None
    other_party: str | None
    transaction_type: TransactionType | None
    category: TransactionCategory | None
    note: str | None
    frequency: RecurrenceFrequency
    day_of_month: int | None
    day_of_week: int | None
    next_run_date: datetime.date
