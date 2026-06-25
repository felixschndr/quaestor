import pytest
from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider, handler_for
from source.backend.bank_handlers.base import BankHandler
from source.backend.bank_handlers.dfs_handler import DFSHandler
from source.backend.bank_handlers.fints_handler import FinTSHandler
from source.backend.bank_handlers.manual_handler import ManualHandler
from source.backend.bank_handlers.trade_republic import TradeRepublicHandler


@pytest.mark.parametrize(
    argnames="provider, expected_handler_class",
    argvalues=[
        (BankProvider.DFS, DFSHandler),
        (BankProvider.TRADE_REPUBLIC, TradeRepublicHandler),
        (BankProvider.MANUAL, ManualHandler),
        (BankProvider.FINTS, FinTSHandler),
    ],
)
def test_handler_for_returns_handler_with_matching_bank_info(
    provider: BankProvider, expected_handler_class: type[BankHandler]
):
    bank_info = BANKS_BY_NAME[provider.value]
    credentials = {field: "x" for field in bank_info.handler.credential_fields(bank_info)}  # noqa: C420

    handler = handler_for(provider=provider, credentials=credentials)

    assert isinstance(handler, expected_handler_class)
    assert handler.bank_info is BANKS_BY_NAME[provider.value]
    assert handler.credentials == credentials


def test_generic_fints_provider_resolves_to_fints_handler():
    bank_info = BANKS_BY_NAME[BankProvider.FINTS.value]

    assert bank_info.handler is FinTSHandler
    assert bank_info.bank_identifier is None
    assert bank_info.fints_url is None
    assert FinTSHandler.credential_fields(bank_info) == ("username", "password", "blz")
