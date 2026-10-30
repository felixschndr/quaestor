import asyncio

import pytest
from sqlalchemy.orm import sessionmaker

from source.backend.models.transactions.category_source import CategorySource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.transactions import category_rescan
from source.backend.services.transactions.category_rescan import run_startup_rescan as real_run_startup_rescan
from tests.backend.conftest import (
    REWE,
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    assert_log_contains,
    category_of,
    persist_account_with_new_user,
    persist_transaction,
)


@pytest.fixture
def account_id(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(target=category_rescan, name="SessionLocal", value=session_factory)
    return persist_account_with_new_user(session_factory)


def test_rescan_updates_unknown_transactions_that_now_match(session_factory: sessionmaker, account_id: int):
    transaction_id = persist_transaction(
        session_factory=session_factory, account_id=account_id, category=TransactionCategory.UNKNOWN, other_party=REWE
    )

    category_rescan.rescan_categories_sync()

    assert (
        category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.SUPERMARKET
    )


def test_rescan_rederives_automatic_categories_that_no_longer_match(session_factory: sessionmaker, account_id: int):
    transaction_id = persist_transaction(
        session_factory=session_factory, account_id=account_id, category=TransactionCategory.DRUGSTORE, other_party=REWE
    )

    category_rescan.rescan_categories_sync()

    assert (
        category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.SUPERMARKET
    )


def test_rescan_leaves_truly_unknown_transactions_alone(session_factory: sessionmaker, account_id: int):
    transaction_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party=UNKNOWN_TRANSACTION_OTHER_PARTY,
    )

    category_rescan.rescan_categories_sync()

    assert category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.UNKNOWN


@pytest.mark.parametrize(
    argnames="category_source", argvalues=[CategorySource.MANUAL, CategorySource.CONTRACT, CategorySource.SYSTEM]
)
def test_rescan_does_not_touch_categories_that_did_not_come_from_the_matchers(
    session_factory: sessionmaker, account_id: int, category_source: CategorySource
):
    transaction_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.DRUGSTORE,
        category_source=category_source,
        other_party=REWE,
    )

    category_rescan.rescan_categories_sync()

    assert category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.DRUGSTORE


def test_rescan_matches_linked_transfers_on_the_type_the_bank_reported(session_factory: sessionmaker, account_id: int):
    transaction_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.SAVINGS,
        transaction_type=TransactionType.TRANSFER_IN,
    )
    with session_factory() as session:
        session.get(entity=Transaction, ident=transaction_id).transfer_original_type = TransactionType.DEPOSIT
        session.commit()

    category_rescan.rescan_categories_sync()

    assert category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.SAVINGS


def test_rescan_logs_summary_at_info(session_factory: sessionmaker, account_id: int, caplog: pytest.LogCaptureFixture):
    rewe_id = persist_transaction(
        session_factory=session_factory, account_id=account_id, category=TransactionCategory.UNKNOWN, other_party=REWE
    )
    persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        category=TransactionCategory.UNKNOWN,
        other_party=UNKNOWN_TRANSACTION_OTHER_PARTY,
    )

    category_rescan.rescan_categories_sync()

    assert_log_contains(
        caplog=caplog,
        messages=[
            "Starting re-scan of transactions categorised AUTO",
            f"Re-scanned <Transaction(id={rewe_id}",
            ")> from UNKNOWN to SUPERMARKET",
            "Re-derived the categories of 1 transaction(s) of <User(id=1",
        ],
    )


def test_run_startup_rescan_logs_exception_instead_of_crashing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    def category_rescan_mock() -> None:
        raise RuntimeError("Something went wrong.")

    monkeypatch.setattr(target=category_rescan, name="rescan_categories_sync", value=category_rescan_mock)

    asyncio.run(real_run_startup_rescan())

    assert_log_contains(caplog=caplog, message="Startup category re-scan crashed")
