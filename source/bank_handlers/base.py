from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from dataclasses import dataclass


@dataclass(frozen=True)
class FetchedAccount:
    external_id: str
    name: str


class BankSession(ABC):
    def __init__(self):
        self._account_mapping = {}

    @abstractmethod
    def get_accounts(self) -> list[FetchedAccount]:
        raise NotImplementedError

    @abstractmethod
    def get_balance(self, account: FetchedAccount) -> float:
        raise NotImplementedError


class BankHandler(ABC):
    EXTRA_CREDENTIAL_FIELDS: tuple[str, ...] = ()

    def __init__(self, bank_info: "BankInfo", username: str, password: str, extra: dict[str, str] | None = None):
        self.bank_info = bank_info
        self.username = username
        self.password = password
        self.extra = extra or {}

    @abstractmethod
    def session(self) -> AbstractContextManager[BankSession]:
        raise NotImplementedError


@dataclass(frozen=True)
class BankInfo:
    """The single source of truth for one supported bank provider.

    Defines what the provider is called, which handler talks to it, and the
    FinTS connection parameters (if any). The fields a user must supply are
    derived from the handler so they stay in one place.
    """

    name: str
    handler: type[BankHandler]
    bank_identifier: str | None
    fints_url: str | None

    @property
    def required_fields(self) -> list[str]:
        return ["username", "password", *self.handler.EXTRA_CREDENTIAL_FIELDS]
