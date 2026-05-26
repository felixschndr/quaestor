from datetime import date

import pytest
from source.backend.exceptions import AccountNotFoundError
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from source.backend.services import account_service
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    SECOND_USER_NAME,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)


def _create_user_with_accounts(session_factory: sessionmaker) -> tuple[int, list[int]]:
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id)
        first = make_account(session, credential_id=credential.id, name="DE-1", balance=10.0)
        second = make_account(session, credential_id=credential.id, name="DE-2", balance=20.0)
        session.commit()
        return user.id, [first.id, second.id]


def test_list_accounts_returns_only_accounts_belonging_to_the_user(session_factory: sessionmaker):
    user_id, expected_ids = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        other = make_user(session, user_name=SECOND_USER_NAME, display_name="Other")
        other_credential = make_credential(session, user_id=other.id)
        make_account(session, credential_id=other_credential.id, name="OTHER")
        session.commit()

    with session_factory() as session:
        accounts = account_service.list_accounts(db_session=session, user_id=user_id)

    assert {account.id for account in accounts} == set(expected_ids)


def test_list_accounts_empty_when_user_has_no_credentials(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        session.commit()
        user_id = user.id

    with session_factory() as session:
        assert account_service.list_accounts(db_session=session, user_id=user_id) == []


def test_get_account_raises_when_id_unknown(session_factory: sessionmaker):
    with session_factory() as session:
        with pytest.raises(AccountNotFoundError, match="not found"):
            account_service.get_account(db_session=session, account_id=99999)


@pytest.mark.parametrize(
    argnames="filter_parameters, indexes_of_not_expected_transactions",
    argvalues=[
        ({}, []),
        ({"text": "Supermarket"}, [1]),
        ({"text": "Drug store"}, [0]),
        ({"text": "Rewe"}, [1]),
        ({"text": "rewe"}, [1]),
        ({"text": "REWE"}, [1]),
        ({"amount_from": 5}, []),
        ({"amount_from": 5, "amount_to": 10}, []),
        ({"amount_to": 10}, []),
        ({"date_from": "2026-01-01"}, []),
        ({"date_from": "2026-01-01", "date_to": "2026-01-31"}, []),
        ({"date_to": "2026-01-31"}, []),
        ({"transaction_type": "INCOMING"}, []),
        ({"category": "INTEREST"}, []),
        ({"note": "first car"}, []),
        # `text` is the unified free-text search and must also cover note.
        ({"text": "first car"}, []),
        ({"text": "loan"}, []),
        # Negative cases — fixtures don't match, so everything is excluded.
        ({"amount_from": 11}, [0, 1]),
        ({"amount_to": 9}, [0, 1]),
        ({"date_from": "2026-01-02"}, [0, 1]),
        ({"date_to": "2025-12-31"}, [0, 1]),
        ({"transaction_type": "OUTGOING"}, [0, 1]),
        ({"category": "SUPERMARKET"}, [0, 1]),
        ({"note": "no such note"}, [0, 1]),
        ({"text": "missing"}, [0, 1]),
        # Combined filters must AND together.
        ({"text": "Rewe", "amount_to": 9}, [0, 1]),
        ({"text": "Rewe", "amount_from": 5}, [1]),
    ],
)
def test_filter_transactions(
    session_factory: sessionmaker, filter_parameters: dict, indexes_of_not_expected_transactions: list[int]
):
    # Use the real public entry point — service-level ownership check + filter
    # logic in one go. We persist a user + credential + account so the
    # ownership guard inside `get_filtered_transactions_for_user` is happy.
    user_id, account_ids = _create_user_with_accounts(session_factory)
    account_id = account_ids[0]
    common_attrs = {
        "account_id": account_id,
        "amount": 10.0,
        "date": date(year=2026, month=1, day=1),
        "transaction_type": TransactionType.INCOMING,
        "category": TransactionCategory.INTEREST,
        "note": "first car loan",
    }
    with session_factory() as session:
        all_transactions = [
            make_transaction(session, purpose="Supermarket", other_party="Rewe", **common_attrs),
            make_transaction(session, purpose="Drug store", other_party="DM", **common_attrs),
        ]
        session.commit()
    expected_ids = [
        all_transactions[i].id for i in range(len(all_transactions)) if i not in indexes_of_not_expected_transactions
    ]

    with session_factory() as session:
        filtered_transactions = account_service.get_filtered_transactions_for_user(
            db_session=session,
            user_id=user_id,
            account_ids_to_search_through=[account_id],
            filter_parameters=filter_parameters,
        )

        assert [t.id for t in filtered_transactions] == expected_ids
