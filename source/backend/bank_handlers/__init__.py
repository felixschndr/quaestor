from enum import Enum

from source.backend.bank_handlers.base import BankHandler, BankInfo
from source.backend.bank_handlers.dfs_handler import DFSHandler
from source.backend.bank_handlers.enable_banking_handler import EnableBankingHandler
from source.backend.bank_handlers.fin4u_handler import Fin4uHandler
from source.backend.bank_handlers.fints_handler import FinTSHandler
from source.backend.bank_handlers.manual_handler import ManualHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler

SUPPORTED_BANKS: list[BankInfo] = [
    BankInfo(name="fints", handler=FinTSHandler),
    BankInfo(name="enable_banking", handler=EnableBankingHandler),
    BankInfo(name="dfs", handler=DFSHandler),
    BankInfo(name="fin4u", handler=Fin4uHandler),
    BankInfo(name="trade_republic", handler=TradeRepublicHandler),
    BankInfo(name="manual", handler=ManualHandler),
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
