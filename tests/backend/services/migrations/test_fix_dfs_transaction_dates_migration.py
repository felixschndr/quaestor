from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text

from tests.backend.conftest import DEFAULT_AMOUNT


def test_moves_synced_dfs_transactions_and_marks_unsettled_ones_pending(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    migration = load_migration(74)
    with migration_test_engine.begin() as conn:
        conn.execute(text("CREATE TABLE credentials (id INTEGER PRIMARY KEY, bank TEXT)"))
        conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, credential_id INTEGER)"))
        conn.execute(
            text(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER, date DATE, amount REAL, "
                "pending BOOLEAN, expected BOOLEAN, recurring_transaction_id INTEGER)"
            )
        )
        conn.execute(text("INSERT INTO credentials (id, bank) VALUES (1, 'DFS'), (2, 'FINTS')"))
        conn.execute(text("INSERT INTO accounts (id, credential_id) VALUES (10, 1), (20, 2)"))
        conn.execute(
            text(
                "INSERT INTO transactions (id, account_id, date, amount, pending, expected, recurring_transaction_id) "
                "VALUES "
                "(1, 10, '2026-04-29', :amount, 0, 0, NULL), "  # synced from DFS -> moved
                "(2, 10, '2026-12-31', :amount, 0, 0, NULL), "  # synced from DFS, crosses the year -> moved
                "(3, 10, '2026-09-14', 0,       0, 0, NULL), "  # unsettled fund switch -> moved and pending
                "(4, 10, '2026-05-01', 0,       0, 1, NULL), "  # expected, dated by the user -> untouched
                "(5, 10, '2026-05-01', :amount, 0, 0, 7), "  # booked by a recurring transaction -> untouched
                "(6, 20, '2026-04-29', 0,       0, 0, NULL)"  # other bank -> untouched
            ),
            parameters={"amount": DEFAULT_AMOUNT},
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration.upgrade()

        rows = {row[0]: (row[1], row[2]) for row in conn.execute(text("SELECT id, date, pending FROM transactions"))}
    assert rows == {
        1: ("2026-04-30", 0),
        2: ("2027-01-01", 0),
        3: ("2026-09-15", 1),
        4: ("2026-05-01", 0),
        5: ("2026-05-01", 0),
        6: ("2026-04-29", 0),
    }
