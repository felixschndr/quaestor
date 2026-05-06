from enum import Enum

from source.bank_handlers.base import BankHandler
from source.bank_handlers.ing import INGBankHandler


class BankProvider(Enum):
    ING = "ing"


HANDLERS: dict[BankProvider, type[BankHandler]] = {
    BankProvider.ING: INGBankHandler,
}


__all__ = ["BankHandler", "BankProvider", "HANDLERS"]
