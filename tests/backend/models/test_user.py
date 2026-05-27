from source.backend.models.theme import Theme
from source.backend.models.user import User
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD_HASH,
    make_account,
    make_credential,
    make_user,
)


def test_user_repr_contains_identifying_fields_but_not_password():
    user = User(
        id=1,
        user_name=USER_NAME,
        display_name=DISPLAY_NAME,
        password_hash=VALID_PASSWORD_HASH,
        language="en",
        theme=Theme.SYSTEM,
    )

    representation = repr(user)

    assert (
        representation == f"<User(id=1, user_name={USER_NAME}, display_name={DISPLAY_NAME}, language=en, theme=SYSTEM)>"
    )
    assert VALID_PASSWORD_HASH not in representation


def test_user_language_defaults_to_en(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        session.commit()
        session.refresh(user)

        assert user.language == "en"


def test_user_balance_scales_each_account_by_its_balance_factor(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id)
        make_account(session, credential_id=credential.id, name="full", balance=400.0, balance_factor=100)
        make_account(session, credential_id=credential.id, name="half", balance=200.0, balance_factor=50)
        make_account(session, credential_id=credential.id, name="hidden", balance=999.0, balance_factor=0)
        session.commit()

        assert user.balance == 400.0 + 200.0 * 0.5 + 999.0 * 0.0
