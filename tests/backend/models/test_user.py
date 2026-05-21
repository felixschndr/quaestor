from source.backend.bank_handlers import BankProvider
from source.backend.models.account import Account
from source.backend.models.credential import Credential
from source.backend.models.user import User
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import BANK_PASSWORD, BANK_USERNAME, DISPLAY_NAME, USER_NAME


def test_user_repr_contains_identifying_fields_but_not_password():
    user = User(
        id=1, user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash="secret_hash", language="en"  # nosec B106
    )

    representation = repr(user)

    assert representation == f"<User(id=1, user_name={USER_NAME}, display_name={DISPLAY_NAME}, language=en)>"
    assert "secret_hash" not in representation


def test_user_language_defaults_to_en(session_factory: sessionmaker):
    with session_factory() as session:
        user = User(user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash="hash")  # nosec B106
        session.add(user)
        session.commit()
        session.refresh(user)

        assert user.language == "en"


def test_user_balance_scales_each_account_by_its_balance_factor(session_factory: sessionmaker):
    with session_factory() as session:
        user = User(user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash="hash")  # nosec B106
        credential = Credential(
            user=user,
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
            requires_two_factor_authentication=False,
        )
        credential.accounts.append(Account(name="full", balance=400.0, balance_factor=100))
        credential.accounts.append(Account(name="half", balance=200.0, balance_factor=50))
        credential.accounts.append(Account(name="hidden", balance=999.0, balance_factor=0))
        session.add(user)
        session.commit()

        assert user.balance == 400.0 + 200.0 * 0.5 + 999.0 * 0.0
