from datetime import datetime

from source.backend.bank_handlers import BankProvider
from source.backend.bank_handlers.base import BankHandler
from source.backend.models.credential import Credential

from tests.backend.conftest import USER_NAME, VALID_PASSWORD


def test_credential_repr_contains_identifying_fields_but_not_secrets():
    fetched_at = datetime(year=2026, month=5, day=20, hour=10, minute=30)
    credential = Credential(
        id=8,
        user_id=1,
        bank=BankProvider.ING,
        credentials={"username": USER_NAME, "password": VALID_PASSWORD},
        last_fetching_timestamp=fetched_at,
        requires_two_factor_authentication=False,
    )

    representation = repr(credential)

    assert representation == (
        f"<Credential(id=8, user_id=1, bank=ing, last_fetching_timestamp={fetched_at}, "
        "requires_two_factor_authentication=False)>"
    )
    assert VALID_PASSWORD not in representation  # nosec B105


def test_handler_property_returns_handler_instance_for_configured_bank():
    credential = Credential(
        id=1,
        user_id=1,
        bank=BankProvider.ING,
        credentials={"username": USER_NAME, "password": VALID_PASSWORD},
    )

    handler = credential.handler

    assert isinstance(handler, BankHandler)
    assert handler.credentials == {"username": USER_NAME, "password": VALID_PASSWORD}
