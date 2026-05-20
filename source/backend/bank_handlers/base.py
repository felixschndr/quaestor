from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date

from source.backend.models.transaction_type import TransactionType


@dataclass(frozen=True)
class FetchedAccount:
    name: str


@dataclass(frozen=True)
class FetchedTransaction:
    amount: float
    purpose: str | None
    date: date
    other_party: str | None
    transaction_type: TransactionType | None = None

    def __post_init__(self) -> None:
        if self.purpose:
            object.__setattr__(self, "purpose", self.purpose.strip())
        if self.other_party:
            object.__setattr__(self, "other_party", self.other_party.strip())


class BankSession(ABC):
    def __init__(self):
        self._account_mapping = {}

    @abstractmethod
    def get_accounts(self) -> list[FetchedAccount]: ...

    @abstractmethod
    def get_balance(self, account: FetchedAccount) -> float: ...

    @abstractmethod
    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]: ...


class BankHandler(ABC):
    # Each handler declares exactly which credential keys it needs. Not every bank
    # uses username/password (e.g., Trade Republic uses phone/pin).
    CREDENTIAL_FIELDS: tuple[str, ...]

    def __init__(self, bank_info: "BankInfo", credentials: dict[str, str]):
        self.bank_info = bank_info
        self.credentials = credentials

    @abstractmethod
    def session(self) -> AbstractContextManager[BankSession]: ...


@dataclass(frozen=True)
class BankInfo:
    name: str
    handler: type[BankHandler]
    bank_identifier: str | None = None
    fints_url: str | None = None
    note: str | None = None

    @property
    def required_fields(self) -> list[str]:
        return list(self.handler.CREDENTIAL_FIELDS)

    @property
    def information_for_user(self) -> dict:
        info = {
            "Bank Name": self.name,
            "Required Fields": self.required_fields,
        }
        if self.bank_identifier is not None:
            info["Bank Identifier"] = self.bank_identifier
        if self.note is not None:
            info["Note"] = self.note
        return info
