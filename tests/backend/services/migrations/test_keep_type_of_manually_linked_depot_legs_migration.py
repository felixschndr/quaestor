from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text


def test_restores_the_type_of_manually_linked_depot_legs_only(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    migration = load_migration(75)
    with migration_test_engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE account_balance_snapshots (id INTEGER PRIMARY KEY, account_id INTEGER, source TEXT)")
        )
        conn.execute(
            text(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER, transaction_type TEXT, "
                "transfer_original_type TEXT, related_link_source TEXT)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO account_balance_snapshots (id, account_id, source) VALUES "
                "(1, 10, 'MARKET_VALUED'), (2, 10, 'MARKET_VALUED'), (3, 20, 'TRANSACTIONS')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO transactions (id, account_id, transaction_type, transfer_original_type, related_link_source) "
                "VALUES "
                "(1, 10, 'TRANSFER_OUT', 'BUY', 'MANUAL'), "  # manually linked depot buy -> restored
                "(2, 10, 'BUY', NULL, 'DETECTED'), "  # detected depot leg already kept its type -> untouched
                "(3, 20, 'TRANSFER_OUT', 'BUY', 'MANUAL'), "  # cash-side leg stays a transfer -> untouched
                "(4, 10, 'BUY', NULL, NULL)"  # not linked -> untouched
            )
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration.upgrade()

        rows = {
            row[0]: (row[1], row[2])
            for row in conn.execute(text("SELECT id, transaction_type, transfer_original_type FROM transactions"))
        }
    assert rows == {
        1: ("BUY", None),
        2: ("BUY", None),
        3: ("TRANSFER_OUT", "BUY"),
        4: ("BUY", None),
    }
