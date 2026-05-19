from enum import Enum

from source.backend.bank_handlers.base import BankHandler, BankInfo
from source.backend.bank_handlers.dfs_handler import DFSHandler
from source.backend.bank_handlers.fints_handler import FinTSHandler
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
        bank_identifier=None,
        fints_url=None,
    ),
    BankInfo(
        name="trade_republic",
        handler=TradeRepublicHandler,
        bank_identifier=None,
        fints_url=None,
    ),
]

BANKS_BY_NAME: dict[str, BankInfo] = {bank.name: bank for bank in SUPPORTED_BANKS}

BankProvider = Enum(
    value="BankProvider",
    names={bank.name.upper(): bank.name for bank in SUPPORTED_BANKS},
    type=str,
)


def handler_for(
    provider: BankProvider, username: str, password: str, extra: dict[str, str] | None = None
) -> BankHandler:
    bank_info = BANKS_BY_NAME[provider.value]
    return bank_info.handler(bank_info=bank_info, username=username, password=password, extra=extra)
