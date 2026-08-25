from enum import Enum

from source.backend.bank_handlers.base import BankHandler, BankInfo
from source.backend.bank_handlers.dfs_handler import DFSHandler
from source.backend.bank_handlers.enable_banking_handler import EnableBankingHandler
from source.backend.bank_handlers.fin4u_handler import Fin4uHandler
from source.backend.bank_handlers.fints_handler import FinTSHandler
from source.backend.bank_handlers.manual_handler import ManualHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler


class BankProvider(str, Enum):
    FINTS = "fints"
    ENABLE_BANKING = "enable_banking"
    DFS = "dfs"
    FIN4U = "fin4u"
    TRADE_REPUBLIC = "trade_republic"
    MANUAL = "manual"


SUPPORTED_BANKS: list[BankInfo] = [
    BankInfo(name=BankProvider.FINTS.value, handler=FinTSHandler),
    BankInfo(name=BankProvider.ENABLE_BANKING.value, handler=EnableBankingHandler),
    BankInfo(name=BankProvider.DFS.value, handler=DFSHandler),
    BankInfo(name=BankProvider.FIN4U.value, handler=Fin4uHandler),
    BankInfo(name=BankProvider.TRADE_REPUBLIC.value, handler=TradeRepublicHandler),
    BankInfo(name=BankProvider.MANUAL.value, handler=ManualHandler),
]

BANKS_BY_NAME: dict[str, BankInfo] = {bank.name: bank for bank in SUPPORTED_BANKS}

if set(BANKS_BY_NAME) != {provider.value for provider in BankProvider}:
    raise RuntimeError("BankProvider enum and SUPPORTED_BANKS handler list are out of sync")


def handler_for(provider: BankProvider, credentials: dict[str, str]) -> BankHandler:
    bank_info = BANKS_BY_NAME[provider.value]
    return bank_info.handler(bank_info=bank_info, credentials=credentials)
