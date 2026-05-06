from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class FetchedTransaction:
    amount: float
    timestamp: datetime


class BankHandler(ABC):
    def __init__(self, name: str, username: str, password: str):
        self.name = name
        self.username = username
        self.password = password

    @abstractmethod
    def get_balance(self) -> float:
        raise NotImplementedError

    @abstractmethod
    def fetch_new_transactions(self, last_synced_at: datetime | None) -> list[FetchedTransaction]:
        raise NotImplementedError
