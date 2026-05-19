from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from dataclasses import dataclass


@dataclass(frozen=True)
class FetchedAccount:
    name: str


class BankSession(ABC):
    def __init__(self):
        self._account_mapping = {}

    @abstractmethod
    def get_accounts(self) -> list[FetchedAccount]: ...

    @abstractmethod
    def get_balance(self, account: FetchedAccount) -> float: ...


class BankHandler(ABC):
    EXTRA_CREDENTIAL_FIELDS: tuple[str, ...] = ()

    def __init__(self, bank_info: "BankInfo", username: str, password: str, extra: dict[str, str] | None = None):
        self.bank_info = bank_info
        self.username = username
        self.password = password
        self.extra = extra or {}

    @abstractmethod
    def session(self) -> AbstractContextManager[BankSession]: ...


@dataclass(frozen=True)
class BankInfo:
    name: str
    handler: type[BankHandler]
    bank_identifier: str | None
    fints_url: str | None

    @property
    def required_fields(self) -> list[str]:
        return ["username", "password", *self.handler.EXTRA_CREDENTIAL_FIELDS]
