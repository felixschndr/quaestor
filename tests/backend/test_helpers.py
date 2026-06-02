from datetime import date
from typing import Any

import pytest
from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.helpers import (
    epoch_ms_to_date,
    format_transaction_for_categorization,
    get_backend_source_path,
    get_frontend_source_path,
    get_key_of_transaction,
    get_project_name,
    get_root_path_of_repository,
)
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_type import TransactionType

from tests.backend.conftest import create_fetched_transaction


def test_key_is_identical_for_two_identical_transactions():
    assert get_key_of_transaction(create_fetched_transaction()) == get_key_of_transaction(create_fetched_transaction())


@pytest.mark.parametrize(
    argnames="changed_key, changed_value",
    argvalues=[
        ("amount", -12.35),
        ("purpose", "Tea"),
        ("other_party", "Other Cafe"),
        ("date", date(year=2026, month=5, day=22)),
    ],
)
def test_key_differs_when_any_identifying_field_differs(changed_key: str, changed_value: Any):
    base_key = get_key_of_transaction(create_fetched_transaction())
    changed_transaction = create_fetched_transaction(**{changed_key: changed_value})

    assert get_key_of_transaction(changed_transaction) != base_key


def test_key_matches_between_transaction_and_fetched_transaction():
    fetched_transaction = create_fetched_transaction(purpose="Coffee", other_party="Cafe")
    persisted_transaction = Transaction(
        account_id=1,
        amount=fetched_transaction.amount,
        purpose=fetched_transaction.purpose,
        date=fetched_transaction.date,
        other_party=fetched_transaction.other_party,
        transaction_type=fetched_transaction.transaction_type,
    )

    assert get_key_of_transaction(persisted_transaction) == get_key_of_transaction(fetched_transaction)


@pytest.mark.parametrize(argnames="epoch_input", argvalues=[1700000000000, "1700000000000"])
def test_epoch_ms_to_date_accepts_int_and_str(epoch_input: str | int):
    # 1700000000000 ms = 2023-11-14 22:13:20 UTC
    assert epoch_ms_to_date(epoch_input) == date(year=2023, month=11, day=14)


def test_get_root_path_of_repository_points_at_the_repo_root():
    root = get_root_path_of_repository()

    assert root.is_dir()
    assert (root / "pyproject.toml").is_file()
    assert (root / "alembic.ini").is_file()


def test_get_backend_source_path_points_at_source_backend():
    backend = get_backend_source_path()

    assert backend.is_dir()
    assert backend.name == "backend"
    assert backend.parent.name == "source"
    assert (backend / "main.py").is_file()


def test_get_frontend_source_path_points_at_source_frontend():
    frontend = get_frontend_source_path()

    assert frontend.is_dir()
    assert frontend.name == "frontend"
    assert frontend.parent.name == "source"
    assert (frontend / "package.json").is_file()


def test_get_project_name_reads_the_name_from_pyproject():
    assert get_project_name() == "Quaestor"


def test_format_transaction_for_categorization_renders_identifying_fields():
    fetched_transaction = FetchedTransaction(
        amount=-19.99,
        purpose="Coffee",
        other_party="Café",
        date=date(year=2026, month=5, day=20),
        transaction_type=TransactionType.OUTGOING,
    )
    transaction = Transaction.from_fetched(fetched_transaction)
    transaction.id = 1

    assert format_transaction_for_categorization(fetched_transaction) == (
        f"<FetchedTransaction(amount={transaction.amount}, purpose={transaction.purpose}, "
        f"other_party={transaction.other_party}, transaction_type={transaction.transaction_type})>"
    )
    assert format_transaction_for_categorization(transaction) == (
        f"<Transaction(id={transaction.id}, amount={transaction.amount}, purpose={transaction.purpose}, "
        f"other_party={transaction.other_party}, transaction_type={transaction.transaction_type})>"
    )


def test_backend_and_frontend_are_siblings_under_the_repo_root():
    root = get_root_path_of_repository()
    backend = get_backend_source_path()
    frontend = get_frontend_source_path()

    assert backend.parent == frontend.parent
    assert backend.parent.parent == root
