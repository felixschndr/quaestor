from datetime import date

import pytest
from source.backend.bank_handlers import BANKS_BY_NAME
from source.backend.bank_handlers.base import FetchedAccount
from source.backend.bank_handlers.manual_handler import ManualHandler

from tests.backend.conftest import assert_log_contains


def test_manual_handler_declares_no_credential_fields():
    assert ManualHandler.CREDENTIAL_FIELDS == ()


def test_manual_session_returns_empty_accounts_and_transactions(caplog: pytest.LogCaptureFixture):
    handler = ManualHandler(bank_info=BANKS_BY_NAME["manual"], credentials={})

    with handler.session() as bank_session:
        assert bank_session.get_accounts() == []
        assert (
            bank_session.get_transactions(
                account=FetchedAccount(name="placeholder"),
                start_date=date(year=2026, month=1, day=1),
            )
            == []
        )
        assert bank_session.get_balance(FetchedAccount(name="placeholder")) == 0.0

    assert_log_contains(
        caplog,
        messages=["get_transactions() was called on ManualHandler", "get_balance() was called on ManualHandler"],
    )


def test_manual_handler_is_registered_in_supported_banks():
    bank_info = BANKS_BY_NAME["manual"]

    assert bank_info.handler is ManualHandler
    assert bank_info.required_fields == []
    assert bank_info.icon == "/static/banks/manual.png"
