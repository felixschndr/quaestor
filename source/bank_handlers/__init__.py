from enum import Enum

from source.bank_handlers.base import BankHandler, FetchedAccount, FetchedTransaction
from source.bank_handlers.dfs_handler import DFSHandler
from source.bank_handlers.fints_handler import FinTSHandler


class BankProvider(str, Enum):
    ING = "ing"
    DKB = "dkb"
    DFS = "dfs"


HANDLERS: dict[BankProvider, type[BankHandler]] = {
    BankProvider.ING: FinTSHandler,
    BankProvider.DKB: FinTSHandler,
    BankProvider.DFS: DFSHandler,
}

# Fields the user has to provide to create a credential for a given bank.
REQUIRED_FIELDS: list[str] = ["username", "password", "bank"]


def handler_for(provider: BankProvider, username: str, password: str) -> BankHandler:
    return HANDLERS[provider](provider, username, password)


def list_all_possible() -> dict[str, dict]:
    """Describe every credential option and what is required to create it."""
    return {
        provider.value: {
            "bank": provider.value,
            "handler": HANDLERS[provider].__name__,
            "required_fields": REQUIRED_FIELDS,
        }
        for provider in BankProvider
    }


__all__ = [
    "BankHandler",
    "BankProvider",
    "HANDLERS",
    "REQUIRED_FIELDS",
    "handler_for",
    "list_all_possible",
    "FetchedAccount",
    "FetchedTransaction",
]
