import pytest
from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import AccountNotFoundError
from source.backend.models.account import Account
from source.backend.models.credential import Credential
from source.backend.models.user import User
from source.backend.services import account_service
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD_HASH,
)


def _create_user_with_accounts(session_factory: sessionmaker) -> tuple[int, list[int]]:
    with session_factory() as session:
        user = User(user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash=VALID_PASSWORD_HASH)
        credential = Credential(
            user=user,
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
        )
        first = Account(credential=credential, name="DE-1", balance=10.0)
        second = Account(credential=credential, name="DE-2", balance=20.0)
        session.add(user)
        session.commit()
        return user.id, [first.id, second.id]


def test_list_accounts_returns_only_accounts_belonging_to_the_user(session_factory: sessionmaker):
    user_id, expected_ids = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        other = User(user_name="other", display_name="Other", password_hash=VALID_PASSWORD_HASH)
        other_credential = Credential(
            user=other,
            bank=BankProvider.ING,
            credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD},
        )
        Account(credential=other_credential, name="OTHER", balance=0.0)
        session.add(other)
        session.commit()

    with session_factory() as session:
        accounts = account_service.list_accounts(db_session=session, user_id=user_id)

    assert {account.id for account in accounts} == set(expected_ids)


def test_list_accounts_empty_when_user_has_no_credentials(session_factory: sessionmaker):
    with session_factory() as session:
        user = User(user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash=VALID_PASSWORD_HASH)
        session.add(user)
        session.commit()
        user_id = user.id

    with session_factory() as session:
        assert account_service.list_accounts(db_session=session, user_id=user_id) == []


def test_get_account_raises_when_id_unknown(session_factory: sessionmaker):
    with session_factory() as session:
        with pytest.raises(AccountNotFoundError, match="not found"):
            account_service.get_account(db_session=session, account_id=99999)
