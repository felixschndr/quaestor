from enum import Enum

from source.backend.bank_handlers.base import BankHandler, BankInfo
from source.backend.bank_handlers.dfs_handler import DFSHandler
from source.backend.bank_handlers.fints_handler import FinTSHandler
from source.backend.bank_handlers.manual_handler import ManualHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler

SUPPORTED_BANKS: list[BankInfo] = [
    BankInfo(
        name="ing",
        handler=FinTSHandler,
        bank_identifier="50010517",
        fints_url="https://fints.ing.de/fints/",
    ),
    BankInfo(
        name="dkb",
        handler=FinTSHandler,
        bank_identifier="12030000",
        fints_url="https://fints.dkb.de/fints",
    ),
    BankInfo(
        name="dfs",
        handler=DFSHandler,
    ),
    BankInfo(
        name="trade_republic",
        handler=TradeRepublicHandler,
        note="The phone number has to be in the format +491234567890 (with '+' and country code and no spaces).",
    ),
    BankInfo(
        name="manual",
        handler=ManualHandler,
        note="A manual account: balance and transactions are entered by hand.",
    ),
]

BANKS_BY_NAME: dict[str, BankInfo] = {bank.name: bank for bank in SUPPORTED_BANKS}

BankProvider = Enum(
    value="BankProvider",
    names={bank.name.upper(): bank.name for bank in SUPPORTED_BANKS},
    type=str,
)


def handler_for(provider: BankProvider, credentials: dict[str, str]) -> BankHandler:
    bank_info = BANKS_BY_NAME[provider.value]
    return bank_info.handler(bank_info=bank_info, credentials=credentials)
