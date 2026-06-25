import datetime

from pydantic import BaseModel, ConfigDict
from source.backend.api.schemas.transaction import TransactionRead
from source.backend.models.contract import Contract
from source.backend.models.contract_assignment import ContractAssignment
from source.backend.models.contract_frequency import ContractFrequency
from source.backend.models.contract_source import ContractSource
from source.backend.models.transaction_category import TransactionCategory


class ContractCreate(BaseModel):
    name: str
    account_id: int
    category: TransactionCategory | None = None


class ContractUpdate(BaseModel):
    name: str
    category: TransactionCategory | None = None


class ContractMemberRead(TransactionRead):
    contract_assignment: ContractAssignment | None
    is_outlier: bool


class ContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    name: str
    category: TransactionCategory | None
    source: ContractSource
    median_amount: float | None
    amount_spread: float | None
    frequency: ContractFrequency | None
    interval_days: int | None
    expected_next_date: datetime.date | None
    member_count: int = 0

    @classmethod
    def from_contract(cls: type["ContractRead"], contract: Contract) -> "ContractRead":
        instance = cls.model_validate(contract)
        instance.member_count = len(contract.members())
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
