from datetime import date

import pytest
from source.backend.exceptions import (
    ExpectedTransactionNotFoundError,
    PermissionDeniedError,
)
from source.backend.models.account import Account
from source.backend.services import account_service
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    assert_log_contains,
    make_transaction,
    persist_account_with_new_user,
    persist_manual_account_with_new_user,
)


def test_create_expected_transaction_is_pending_expected_and_balance_neutral(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id = persist_account_with_new_user(session_factory, balance=100.0)

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        created = account_service.create_expected_transaction(
            db_session=session,
            account=account,
            fields={"amount": 250.0, "other_party": "ACME", "note": "salary", "match_tolerance_percent": 5},
        )
        created_id = created.id
        assert_log_contains(caplog, message="Created expected")

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        transaction = next(tx for tx in account.transactions if tx.id == created_id)
        assert transaction.pending is True
        assert transaction.expected is True
        assert transaction.match_tolerance_percent == 5
        assert transaction.date == date.today()
        assert account.balance == 100.0  # expected transactions never move the balance


def test_create_expected_transaction_defaults_date_to_today_and_tolerance_to_zero(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        created = account_service.create_expected_transaction(
            db_session=session, account=account, fields={"amount": -10.0}
        )
        assert created.date == date.today()
        assert created.match_tolerance_percent == 0


def test_create_expected_transaction_on_manual_account_is_forbidden(session_factory: sessionmaker):
    account_id = persist_manual_account_with_new_user(session_factory)
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(PermissionDeniedError, match="synced accounts"):
            account_service.create_expected_transaction(db_session=session, account=account, fields={"amount": 10.0})


def test_list_expected_transactions_returns_only_expected_newest_first(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=-1.0)
        make_transaction(session, account_id=account_id, amount=10.0, pending=True, expected=True)
        make_transaction(session, account_id=account_id, amount=20.0, pending=True, expected=True)
        session.commit()

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        expected = account_service.list_expected_transactions(db_session=session, account=account)
        assert all(tx.expected for tx in expected)
        assert len(expected) == 2
        assert [tx.amount for tx in expected] == [20.0, 10.0]


def test_update_expected_transaction_changes_fields(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory, balance=100.0)
    with session_factory() as session:
        expectation = make_transaction(
            session,
            account_id=account_id,
            amount=10.0,
            other_party="ACME",
            note="old",
            pending=True,
            expected=True,
            match_tolerance_percent=0,
        )
        session.commit()
        expectation_id = expectation.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        updated = account_service.update_expected_transaction(
            db_session=session,
            account=account,
            expected_transaction_id=expectation_id,
            fields={"amount": -42.0, "other_party": "Landlord", "note": "rent", "match_tolerance_percent": 15},
        )
        assert updated.amount == -42.0
        assert updated.other_party == "Landlord"
        assert updated.note == "rent"
        assert updated.match_tolerance_percent == 15
        assert updated.pending is True
        assert updated.expected is True

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 100.0


def test_update_expected_transaction_rejects_a_normal_transaction(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)
    with session_factory() as session:
        booked = make_transaction(session, account_id=account_id, amount=-5.0)
        session.commit()
        booked_id = booked.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(ExpectedTransactionNotFoundError):
            account_service.update_expected_transaction(
                db_session=session, account=account, expected_transaction_id=booked_id, fields={"amount": 1.0}
            )


def test_delete_expected_transaction_removes_it(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    account_id = persist_account_with_new_user(session_factory)
    with session_factory() as session:
        expectation = make_transaction(session, account_id=account_id, amount=10.0, pending=True, expected=True)
        session.commit()
        expectation_id = expectation.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        account_service.delete_expected_transaction(
            db_session=session, account=account, expected_transaction_id=expectation_id
        )
        assert_log_contains(caplog, message="Deleted expected transaction")

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.transactions == []


def test_delete_expected_transaction_rejects_a_normal_transaction(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)
    with session_factory() as session:
        booked = make_transaction(session, account_id=account_id, amount=-5.0)
        session.commit()
        booked_id = booked.id

    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        with pytest.raises(ExpectedTransactionNotFoundError):
            account_service.delete_expected_transaction(
                db_session=session, account=account, expected_transaction_id=booked_id
            )
