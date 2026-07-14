from abc import ABC, abstractmethod
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime

from source.backend.models.transactions.transaction_type import TransactionType

TwoFactorStateCallback = Callable[[bool], None]


@dataclass(frozen=True)
class TwoFactorChallenge:
    challenge_token: str
    expires_at: datetime


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
    pending: bool = False

    def __post_init__(self) -> None:
        if self.purpose:
            object.__setattr__(self, "purpose", self.purpose.strip())
        if self.other_party:
            object.__setattr__(self, "other_party", self.other_party.strip())


@dataclass(frozen=True)
class BalanceObservation:
    # A balance the bank itself reported for a specific date.
    # Used as a ground-truth anchor for the account's balance history.
    date: date
    amount: float


class BankSession(ABC):
    @abstractmethod
    def get_accounts(self) -> list[FetchedAccount]: ...

    @abstractmethod
    def get_balance(self, account: FetchedAccount) -> float: ...

    @abstractmethod
    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]: ...

    def get_balance_observations(self, account: FetchedAccount) -> list[BalanceObservation]:
        # Optional: bank-reported balance anchors for the period fetched by the last get_transactions
        # call. Banks that don't expose them (the default) simply return none.
        return []

    def get_market_value_history(self, account: FetchedAccount) -> list[BalanceObservation]:
        # Optional: daily market value (price x quantity) for depot/fund accounts whose worth moves
        # with the market rather than with transactions. Cash/giro accounts (the default) return none.
        return []


@dataclass(frozen=True)
class FieldRule:
    name: str
    regex: str  # must be valid in Python AND JS to be used for backend and frontend
    description: str


class BankHandler(ABC):
    CREDENTIAL_FIELDS: tuple[str, ...]
    FIELD_RULES: dict[str, tuple[FieldRule, ...]] = {}
    WHITESPACE_STRIPPED_FIELDS: frozenset[str] = frozenset()

    session_state: dict | None = None

    def __init__(self, bank_info: "BankInfo", credentials: dict[str, str]):
        self.bank_info = bank_info
        self.credentials = credentials
        self.notify_two_factor_state: TwoFactorStateCallback | None = None

    @classmethod
    def credential_fields(cls: type["BankHandler"], bank_info: "BankInfo") -> tuple[str, ...]:
        # Override when a handler needs different credentials depending on the BankInfo
        # (e.g., FinTS asks for a BLZ when the BankInfo doesn't pin one).
        return cls.CREDENTIAL_FIELDS

    @abstractmethod
    def session(self) -> AbstractContextManager[BankSession]: ...

    def begin_two_factor_challenge(self, credential_id: int) -> TwoFactorChallenge | None:
        return None

    def complete_two_factor_challenge(self, challenge_token: str, credential_id: int, code: str) -> dict:
        raise NotImplementedError(f"{type(self).__name__} does not support an interactive 2FA challenge")


@dataclass(frozen=True)
class BankInfo:
    name: str
    handler: type[BankHandler]
    bank_identifier: str | None = None
    fints_url: str | None = None

    @property
    def required_fields(self) -> list[str]:
        return list(self.handler.credential_fields(self))

    @property
    def icon(self) -> str:
        return f"/static/banks/{self.name}.png"

    @property
    def field_rules(self) -> dict[str, dict]:
        # Single source of truth for input validation, consumed by both the backend
        # (on create) and the frontend (live). A field appears here if it has rules
        # and/or its whitespace is stripped.
        handler = self.handler
        fields = set(handler.FIELD_RULES) | set(handler.WHITESPACE_STRIPPED_FIELDS)
        return {
            field: {
                "strip_whitespace": field in handler.WHITESPACE_STRIPPED_FIELDS,
                "rules": [
                    {"name": rule.name, "regex": rule.regex, "description": rule.description}
                    for rule in handler.FIELD_RULES.get(field, ())  # noqa FKA100
                ],
            }
            for field in self.required_fields
            if field in fields
        }

    @property
    def information_for_user(self) -> dict:
        info = {
            "name": self.name,
            "required_fields": self.required_fields,
            "icon": self.icon,
            "field_rules": self.field_rules,
        }
        if self.bank_identifier is not None:
            info["bank_identifier"] = self.bank_identifier
        return info
