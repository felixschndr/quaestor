from enum import Enum

from source.bank_handlers.base import (
    BankHandler,
    BankInfo,
    FetchedAccount,
    FetchedTransaction,
)
from source.bank_handlers.dfs_handler import DFSHandler
from source.bank_handlers.fints_handler import FinTSHandler

SUPPORTED_BANKS: list[BankInfo] = [
    BankInfo(
        name="ing",
        handler=FinTSHandler,
        required_fields=["username", "password"],
        bank_identifier="50010517",
        fints_url="https://fints.ing.de/fints/",
    ),
    BankInfo(
        name="dkb",
        handler=FinTSHandler,
        required_fields=["username", "password"],
        bank_identifier="12030000",
        fints_url="https://fints.dkb.de/fints",
    ),
    BankInfo(
        name="dfs",
        handler=DFSHandler,
        required_fields=["username", "password"],
        bank_identifier=None,
        fints_url=None,
    ),
]

BANKS_BY_NAME: dict[str, BankInfo] = {bank.name: bank for bank in SUPPORTED_BANKS}

BankProvider = Enum(
    "BankProvider",
    {bank.name.upper(): bank.name for bank in SUPPORTED_BANKS},
    type=str,
)


def handler_for(provider: BankProvider, username: str, password: str) -> BankHandler:
    bank_info = BANKS_BY_NAME[provider.value]
    return bank_info.handler(bank_info, username, password)


def list_all_possible() -> dict[str, dict]:
    """Describe every credential option and what is required to create it."""
    return {
        bank.name: {
            "bank": bank.name,
            "handler": bank.handler.__name__,
            "required_fields": bank.required_fields,
        }
        for bank in SUPPORTED_BANKS
    }


__all__ = [
    "BankHandler",
    "BankInfo",
    "BankProvider",
    "SUPPORTED_BANKS",
    "handler_for",
    "list_all_possible",
    "FetchedAccount",
    "FetchedTransaction",
]
