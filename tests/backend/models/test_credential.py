from datetime import datetime

from source.backend.bank_handlers import BankProvider
from source.backend.models.credential import Credential


def test_credential_repr_contains_identifying_fields_but_not_secrets():
    fetched_at = datetime(year=2026, month=5, day=20, hour=10, minute=30)
    credential = Credential(
        id=8,
        user_id=1,
        bank=BankProvider.ING,
        credentials={"username": "u", "password": "super_secret_pw"},  # nosec B105
        last_fetching_timestamp=fetched_at,
        requires_two_factor_authentication=False,
    )

    representation = repr(credential)

    assert representation == (
        f"<Credential(id=8, user_id=1, bank=ing, last_fetching_timestamp={fetched_at}, "
        "requires_two_factor_authentication=False)>"
    )
    assert "super_secret_pw" not in representation  # nosec B105
