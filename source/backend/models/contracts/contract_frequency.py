from enum import Enum


class ContractFrequency(str, Enum):
    WEEKLY = "WEEKLY"
    BIWEEKLY = "BIWEEKLY"
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    YEARLY = "YEARLY"

    @property
    def interval_days(self) -> int:
        return _INTERVAL_DAYS_BY_FREQUENCY[self]


_INTERVAL_DAYS_BY_FREQUENCY: dict["ContractFrequency", int] = {
    ContractFrequency.WEEKLY: 7,
    ContractFrequency.BIWEEKLY: 14,
    ContractFrequency.MONTHLY: 30,
    ContractFrequency.QUARTERLY: 91,
    ContractFrequency.YEARLY: 365,
}
