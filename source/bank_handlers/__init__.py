from enum import Enum

from source.bank_handlers.base import BankHandler, FetchedTransaction
from source.bank_handlers.ing import INGBankHandler


class BankProvider(Enum):
    ING = "ing"


HANDLERS: dict[BankProvider, type[BankHandler]] = {
    BankProvider.ING: INGBankHandler,
}


def handler_for(provider: BankProvider, username: str, password: str) -> BankHandler:
    return HANDLERS[provider](provider.value, username, password)


__all__ = ["BankHandler", "BankProvider", "HANDLERS", "handler_for", "FetchedTransaction"]
