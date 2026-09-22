from collections.abc import Callable
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Engine, text

from tests.backend.conftest import REWE, UNKNOWN_TRANSACTION_OTHER_PARTY

REVISION = 70

AUTO_UNKNOWN_ID = 1
AUTO_MATCHED_ID = 2
MANUAL_ID = 3
CONTRACT_ID = 4
TYPE_BASED_TRANSFER_ID = 5
REFUND_ID = 6


def test_existing_categories_are_classified_by_replaying_the_matchers(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    with migration_test_engine.begin() as conn:
        conn.execute(text("CREATE TABLE contracts (id INTEGER PRIMARY KEY, category VARCHAR)"))
        conn.execute(
            text(
                "CREATE TABLE transactions ("
                "  id INTEGER PRIMARY KEY, purpose VARCHAR, other_party VARCHAR, transaction_type VARCHAR,"
                "  transfer_original_type VARCHAR, category VARCHAR NOT NULL, contract_id INTEGER"
                ")"
            )
        )
        conn.execute(text("INSERT INTO contracts (id, category) VALUES (1, 'FITNESS')"))
        conn.execute(
            statement=text(
                "INSERT INTO transactions (id, other_party, transaction_type, transfer_original_type, category, "
                "contract_id) VALUES (:id, :other_party, :transaction_type, :transfer_original_type, :category, "
                ":contract_id)"
            ),
            parameters=[
                _row(id=AUTO_UNKNOWN_ID, other_party=UNKNOWN_TRANSACTION_OTHER_PARTY, category="UNKNOWN"),
                _row(id=AUTO_MATCHED_ID, other_party="REWE Markt", category="SUPERMARKET"),
                _row(id=MANUAL_ID, other_party=REWE, category="GIFTS"),
                _row(id=CONTRACT_ID, other_party=REWE, category="FITNESS", contract_id=1),
                _row(
                    id=TYPE_BASED_TRANSFER_ID,
                    category="SAVINGS",
                    transaction_type="TRANSFER_IN",
                    transfer_original_type="DEPOSIT",
                ),
                _row(id=REFUND_ID, other_party=UNKNOWN_TRANSACTION_OTHER_PARTY, category="REIMBURSEMENT"),
            ],
        )

        operations = Operations(MigrationContext.configure(connection=conn))
        migration = load_migration(REVISION)
        monkeypatch.setattr(target=migration, name="op", value=operations)
        migration.upgrade()

        sources = dict(conn.execute(text("SELECT id, category_source FROM transactions")).all())

    assert sources == {
        AUTO_UNKNOWN_ID: "AUTO",
        AUTO_MATCHED_ID: "AUTO",
        MANUAL_ID: "MANUAL",
        CONTRACT_ID: "CONTRACT",
        TYPE_BASED_TRANSFER_ID: "AUTO",
        REFUND_ID: "SYSTEM",
    }


def _row(
    id: int,
    category: str,
    other_party: str | None = None,
    transaction_type: str | None = None,
    transfer_original_type: str | None = None,
    contract_id: int | None = None,
) -> dict:
    return {
        "id": id,
        "other_party": other_party,
        "transaction_type": transaction_type,
        "transfer_original_type": transfer_original_type,
        "category": category,
        "contract_id": contract_id,
    }
