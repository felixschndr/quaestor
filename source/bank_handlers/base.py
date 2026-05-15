from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from source.bank_handlers import BankProvider


@dataclass(frozen=True)
class FetchedAccount:
    external_id: str
    name: str
    balance: float


@dataclass(frozen=True)
class FetchedTransaction:
    amount: float
    timestamp: datetime


class BankHandler(ABC):
    def __init__(self, bank: "BankProvider", username: str, password: str):
        self.bank = bank
        self.username = username
        self.password = password

    @abstractmethod
    def get_accounts(self) -> list[FetchedAccount]:
        raise NotImplementedError

    @abstractmethod
    def get_balance(self, account: FetchedAccount) -> float:
        raise NotImplementedError
