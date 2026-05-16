from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class FetchedAccount:
    external_id: str
    name: str


@dataclass(frozen=True)
class FetchedTransaction:
    amount: float
    timestamp: datetime


class BankSession(ABC):
    """A single open connection/dialog to a bank.

    Created via ``BankHandler.session()`` and used as a context manager so that
    accounts, balances and transactions can all be fetched within one dialog
    instead of opening a fresh connection per call.
    """

    @abstractmethod
    def get_accounts(self) -> list[FetchedAccount]:
        raise NotImplementedError

    @abstractmethod
    def get_balance(self, account: FetchedAccount) -> float:
        raise NotImplementedError

    @abstractmethod
    def get_transactions(self, account: FetchedAccount, since: datetime | None) -> list[FetchedTransaction]:
        raise NotImplementedError


class BankHandler(ABC):
    def __init__(self, bank_info: "BankInfo", username: str, password: str):
        self.bank_info = bank_info
        self.username = username
        self.password = password

    @abstractmethod
    def session(self) -> AbstractContextManager[BankSession]:
        raise NotImplementedError


@dataclass(frozen=True)
class BankInfo:
    """The single source of truth for one supported bank provider.

    Defines what the provider is called, which handler talks to it, which
    fields a user must supply, and the FinTS connection parameters (if any).
    """

    name: str
    handler: type[BankHandler]
    required_fields: list[str]
    bank_identifier: str | None
    fints_url: str | None
