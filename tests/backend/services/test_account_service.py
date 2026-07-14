from datetime import date

import pytest
from sqlalchemy.orm import sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.exceptions import AccountNotFoundError, PermissionDeniedError
from source.backend.models.account import Account
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from source.backend.models.user import User
from source.backend.services import account_service
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    RECENT_DATE,
    SECOND_ACCOUNT_IBAN,
    SECOND_USER_NAME,
    assert_log_contains,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)


def _create_user_with_accounts(session_factory: sessionmaker) -> tuple[int, list[int]]:
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id)
        first = make_account(session, credential_id=credential.id, name=ACCOUNT_IBAN, balance=10.0)
        second = make_account(session, credential_id=credential.id, name=SECOND_ACCOUNT_IBAN, balance=20.0)
        session.commit()
        return user.id, [first.id, second.id]


def test_list_accounts_returns_only_accounts_belonging_to_the_user(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    user_id, expected_ids = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        other = make_user(session, user_name=SECOND_USER_NAME, display_name="Other")
        other_credential = make_credential(session, user_id=other.id)
        make_account(session, credential_id=other_credential.id, name=ACCOUNT_IBAN)
        session.commit()

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        with caplog.at_level("DEBUG", logger="services.account_service"):
            accounts = account_service.list_accounts(db_session=session, user=user)

    assert {account.id for account in accounts} == set(expected_ids)
    assert_log_contains(caplog, message="<User(")


def test_list_accounts_empty_when_user_has_no_credentials(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        session.commit()
        user_id = user.id

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        assert account_service.list_accounts(db_session=session, user=user) == []


def test_get_account_raises_when_id_unknown(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    with session_factory() as session:
        with pytest.raises(AccountNotFoundError, match="not found"):
            account_service.get_account(db_session=session, account_id=99999)
        assert_log_contains(caplog, message="not found")


def _create_user_with_manual_credential(session_factory: sessionmaker) -> tuple[int, int]:
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.MANUAL, credentials={})
        session.commit()
        return user.id, credential.id


def test_create_manual_account_persists_account_with_caller_owned_credential(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    _, credential_id = _create_user_with_manual_credential(session_factory)

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        account = account_service.create_manual_account(
            db_session=session,
            credential=credential,
            name="Wallet",
            display_name="Cash wallet",
            balance=123.45,
            balance_factor=100,
        )
        account_id = account.id

    with session_factory() as session:
        loaded = session.get(entity=Account, ident=account_id)
        assert loaded is not None
        assert loaded.credential_id == credential_id
        assert loaded.name == "Wallet"
        assert loaded.balance == 123.45
    assert_log_contains(caplog, messages=["Created manual <Account("])


def test_create_manual_account_rejects_credential_of_non_manual_bank(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.FINTS)
        session.commit()
        credential_id = credential.id

    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        with pytest.raises(PermissionDeniedError, match="manual"):
            account_service.create_manual_account(
                db_session=session,
                credential=credential,
                name="Bogus",
                display_name=None,
                balance=0.0,
                balance_factor=100,
            )


def test_create_manual_transaction_updates_balance_and_snapshots(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    user_id, credential_id = _create_user_with_manual_credential(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name="Wallet", balance=100.0)
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        transaction = account_service.create_manual_transaction(
            db_session=session,
            account=account,
            fields={
                "amount": -25.0,
                "date": RECENT_DATE,
                "purpose": "Coffee run",
                "other_party": "Rewe",
                "transaction_type": TransactionType.OUTGOING,
            },
        )
        assert transaction.id is not None
        assert account.balance == 75.0
        assert account.balance_at_date[RECENT_DATE].balance == 75.0
        assert_log_contains(caplog, messages=["Created manual", "new balance"])

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        account_service.get_account_for_user(db_session=session, account_id=account_id, user=user)


@pytest.mark.parametrize(
    argnames="extra_fields, expected_category",
    argvalues=[
        ({"category": TransactionCategory.GIFTS}, TransactionCategory.GIFTS),  # explicit category wins
        ({}, TransactionCategory.SUPERMARKET),  # no category -> auto-categorised from other_party
    ],
)
def test_create_manual_transaction_resolves_category(
    session_factory: sessionmaker, extra_fields: dict, expected_category: TransactionCategory
):
    _, credential_id = _create_user_with_manual_credential(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name="Wallet", balance=1000.0)
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        transaction = account_service.create_manual_transaction(
            db_session=session,
            account=account,
            fields={"amount": -19.99, "date": RECENT_DATE, "other_party": "REWE Markt", **extra_fields},
        )
        assert transaction.category == expected_category


def test_update_account_treats_explicit_null_balance_as_no_change(session_factory: sessionmaker):
    _, credential_id = _create_user_with_manual_credential(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name="Wallet", balance=42.0)
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        account_service.update_account(
            db_session=session,
            account=account,
            fields={"balance": None, "display_name": "Renamed"},
        )

    with session_factory() as session:
        loaded = session.get(entity=Account, ident=account_id)
        assert loaded.balance == 42.0
        assert loaded.display_name == "Renamed"


def test_create_manual_transaction_rejects_non_manual_account(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.FINTS)
        account = make_account(session, credential_id=credential.id, name="Real", balance=100.0)
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(PermissionDeniedError, match="manual"):
            account_service.create_manual_transaction(
                db_session=session,
                account=account,
                fields={"amount": 10.0, "date": RECENT_DATE},
            )


def test_delete_transaction_restores_balance(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    _, credential_id = _create_user_with_manual_credential(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name="Wallet", balance=200.0)
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        transaction = account_service.create_manual_transaction(
            db_session=session,
            account=account,
            fields={"amount": -50.0, "date": RECENT_DATE},
        )
        assert account.balance == 150.0
        transaction_id = transaction.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        transaction = session.get(entity=Transaction, ident=transaction_id)
        account_service.delete_transaction(db_session=session, account=account, transaction=transaction)
        assert account.balance == 200.0
        assert_log_contains(caplog, messages=["Deleted manual", "new balance"])

    with session_factory() as session:
        assert session.get(entity=Transaction, ident=transaction_id) is None


def test_delete_account_only_works_for_manual_credential(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as session:
        user = make_user(session)
        real_credential = make_credential(session, user_id=user.id, bank=BankProvider.FINTS)
        manual_credential = make_credential(session, user_id=user.id, bank=BankProvider.MANUAL, credentials={})
        real_account = make_account(session, credential_id=real_credential.id, name="Real")
        manual_account = make_account(session, credential_id=manual_credential.id, name="Manual")
        session.commit()
        real_account_id = real_account.id
        manual_account_id = manual_account.id

    with session_factory() as session:
        with pytest.raises(PermissionDeniedError, match="manual"):
            account_service.delete_account(
                db_session=session, account=session.get(entity=Account, ident=real_account_id)
            )

    with session_factory() as session:
        account_service.delete_account(db_session=session, account=session.get(entity=Account, ident=manual_account_id))
        assert_log_contains(caplog, message="Deleted manual")

    with session_factory() as session:
        assert session.get(entity=Account, ident=manual_account_id) is None
        assert session.get(entity=Account, ident=real_account_id) is not None


def test_update_account_rejects_balance_change_on_non_manual_account(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.FINTS)
        account = make_account(session, credential_id=credential.id, name="Real", balance=42.0)
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(PermissionDeniedError, match="manual"):
            account_service.update_account(db_session=session, account=account, fields={"balance": 100.0})


def test_update_account_balance_recomputes_snapshots_on_manual_account(session_factory: sessionmaker):
    _, credential_id = _create_user_with_manual_credential(session_factory)
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name="Wallet", balance=100.0)
        make_transaction(
            session,
            account_id=account.id,
            amount=-20.0,
            date=RECENT_DATE,
        )
        account.update_balance_at_date()
        session.commit()
        account_id = account.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        original_snapshot = account.balance_at_date[RECENT_DATE].balance
        assert original_snapshot == 100.0

        account_service.update_account(db_session=session, account=account, fields={"balance": 500.0})
        assert account.balance == 500.0
        assert account.balance_at_date[RECENT_DATE].balance == 500.0


def test_get_filtered_transactions_for_user_returns_empty_when_no_account_ids(session_factory: sessionmaker):
    user_id, _ = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        result = account_service.get_filtered_transactions_for_user(
            db_session=session,
            user=user,
            account_ids_to_search_through=[],
            filter_parameters={"text": "anything"},
        )

    assert result == []


def test_resolve_owned_account_ids_returns_owned_subset(session_factory: sessionmaker):
    user_id, account_ids = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        resolved = account_service.resolve_owned_account_ids(db_session=session, user=user, account_ids=account_ids)

    assert sorted(resolved) == sorted(account_ids)


def test_resolve_owned_account_ids_returns_empty_for_empty_input(session_factory: sessionmaker):
    user_id, _ = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        resolved = account_service.resolve_owned_account_ids(db_session=session, user=user, account_ids=[])

    assert resolved == []


def test_resolve_owned_account_ids_raises_for_foreign_account(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    owner_id, owner_account_ids = _create_user_with_accounts(session_factory)
    with session_factory() as session:
        intruder = make_user(session, user_name=SECOND_USER_NAME)
        session.commit()
        intruder_id = intruder.id

    with session_factory() as session:
        intruder = session.get(entity=User, ident=intruder_id)
        with pytest.raises(AccountNotFoundError, match="not found"):
            account_service.resolve_owned_account_ids(db_session=session, user=intruder, account_ids=owner_account_ids)
        assert_log_contains(caplog, message="attempted to access accounts they don't own")


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
        ({"transaction_types": ["INCOMING"]}, []),
        ({"categories": ["INTEREST"]}, []),
        ({"note": "first car"}, []),
        # `text` is the unified free-text search and must also cover note.
        ({"text": "first car"}, []),
        ({"text": "loan"}, []),
        # Negative cases — fixtures don't match, so everything is excluded.
        ({"amount_from": 11}, [0, 1]),
        ({"amount_to": 9}, [0, 1]),
        ({"date_from": "2026-01-02"}, [0, 1]),
        ({"date_to": "2025-12-31"}, [0, 1]),
        ({"transaction_types": ["OUTGOING"]}, [0, 1]),
        ({"categories": ["SUPERMARKET"]}, [0, 1]),
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
        all_transactions[i].id
        for i in reversed(range(len(all_transactions)))
        if i not in indexes_of_not_expected_transactions
    ]

    with session_factory() as session:
        user = session.get(entity=User, ident=user_id)
        filtered_transactions = account_service.get_filtered_transactions_for_user(
            db_session=session,
            user=user,
            account_ids_to_search_through=[account_id],
            filter_parameters=filter_parameters,
        )

        assert [t.id for t in filtered_transactions] == expected_ids


def test_unlink_transactions_clears_both_sides_and_restores_types(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as session:
        user = make_user(session)
        credential = make_credential(session, user_id=user.id, bank=BankProvider.FINTS)
        account_a = make_account(session, credential_id=credential.id, name=ACCOUNT_IBAN)
        account_b = make_account(session, credential_id=credential.id, name=SECOND_ACCOUNT_IBAN)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, transaction_type=TransactionType.TRANSFER_OUT
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, transaction_type=TransactionType.TRANSFER_IN
        )
        out_transaction.transfer_counterpart_id = in_transaction.id
        in_transaction.transfer_counterpart_id = out_transaction.id
        out_transaction.transfer_original_type = TransactionType.OUTGOING
        in_transaction.transfer_original_type = TransactionType.DEPOSIT
        session.flush()

        account_service.unlink_transactions(db_session=session, transaction=out_transaction)

        assert_log_contains(caplog, message="Unlinked")
        assert out_transaction.transfer_counterpart_id is None
        assert in_transaction.transfer_counterpart_id is None
        assert out_transaction.transfer_relink_blocked is True
        assert in_transaction.transfer_relink_blocked is True
        assert out_transaction.transaction_type == TransactionType.OUTGOING
        assert in_transaction.transaction_type == TransactionType.DEPOSIT
        assert out_transaction.transfer_original_type is None
        assert in_transaction.transfer_original_type is None
