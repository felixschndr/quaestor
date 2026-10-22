from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text


def test_archives_only_sold_depot_positions(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    migration = load_migration(76)
    with migration_test_engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE account_balance_snapshots (id INTEGER PRIMARY KEY, account_id INTEGER, source TEXT)")
        )
        conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance FLOAT, is_hidden BOOLEAN)"))
        conn.execute(
            text(
                "INSERT INTO account_balance_snapshots (id, account_id, source) VALUES "
                "(1, 10, 'MARKET_VALUED'), (2, 20, 'MARKET_VALUED'), (3, 30, 'COMPUTED')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO accounts (id, balance, is_hidden) VALUES "
                "(10, 0, 0), "  # sold position -> archived
                "(20, 4200, 0), "  # held position -> untouched
                "(30, 0, 0)"  # empty cash account -> untouched
            )
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration.upgrade()

        rows = dict(conn.execute(text("SELECT id, is_hidden FROM accounts")).all())
    assert rows == {10: 1, 20: 0, 30: 0}
