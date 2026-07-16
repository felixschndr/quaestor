import datetime

from pydantic import BaseModel, ConfigDict

from source.backend.api.schemas.transactions.transaction import TransactionRead
from source.backend.helpers import utc_now
from source.backend.models.contracts.contract import Contract
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.contracts.contract_frequency import ContractFrequency
from source.backend.models.contracts.contract_source import ContractSource
from source.backend.models.transactions.transaction_category import TransactionCategory


class ContractCreate(BaseModel):
    name: str
    account_id: int
    category: TransactionCategory | None = None
    frequency: ContractFrequency | None = None


class ContractUpdate(BaseModel):
    name: str
    category: TransactionCategory | None = None
    note: str | None = None
    frequency: ContractFrequency | None = None


class ContractMemberRead(TransactionRead):
    contract_assignment: ContractAssignment | None
    is_outlier: bool


class ContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    name: str
    note: str | None = None
    category: TransactionCategory | None
    source: ContractSource
    median_amount: float | None
    amount_spread: float | None
    frequency: ContractFrequency | None
    interval_days: int | None
    expected_next_date: datetime.date | None
    is_overdue: bool = False
    member_count: int = 0
    amount_per_day: float | None = None
    amount_per_frequency: dict[ContractFrequency, float] | None = None

    @classmethod
    def from_contract(cls: type["ContractRead"], contract: Contract) -> "ContractRead":
        instance = cls.model_validate(contract)
        instance.is_overdue = contract.is_overdue_on(today=utc_now().date())
        instance.member_count = len(contract.members())

        anchor_days = contract.frequency.interval_days if contract.frequency else contract.interval_days
        if contract.median_amount is not None and anchor_days:
            amount_per_day = contract.median_amount / anchor_days
            instance.amount_per_day = amount_per_day
            instance.amount_per_frequency = {
                frequency: amount_per_day * frequency.interval_days for frequency in ContractFrequency
            }
            if contract.frequency:
                instance.amount_per_frequency[contract.frequency] = contract.median_amount

        return instance


class ContractDetailRead(ContractRead):
    members: list[ContractMemberRead] = []

    @classmethod
    def from_contract(cls: type["ContractDetailRead"], contract: Contract) -> "ContractDetailRead":
        members = sorted(contract.members(), key=lambda transaction: transaction.date, reverse=True)
        return cls(
            **ContractRead.from_contract(contract).model_dump(),
            members=[
                ContractMemberRead(
                    **TransactionRead.model_validate(transaction).model_dump(),
                    contract_assignment=transaction.contract_assignment,
                    is_outlier=contract.is_outlier(transaction),
                )
                for transaction in members
            ],
        )


class ContractAssignRequest(BaseModel):
    transaction_id: int
