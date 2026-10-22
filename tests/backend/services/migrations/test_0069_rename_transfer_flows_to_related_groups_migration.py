from collections.abc import Callable
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, Engine, inspect, text

REVISION = 69


def _apply(
    conn: Connection, load_migration: Callable[[int], ModuleType], monkeypatch: pytest.MonkeyPatch, step: str
) -> None:
    operations = Operations(MigrationContext.configure(connection=conn))
    migration = load_migration(REVISION)
    monkeypatch.setattr(target=migration, name="op", value=operations)
    getattr(migration, step)()


def test_flows_are_renamed_to_related_groups_keeping_their_members(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    with migration_test_engine.begin() as conn:
        conn.execute(text("CREATE TABLE transfer_flows (id INTEGER NOT NULL, PRIMARY KEY (id))"))
        conn.execute(
            text(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, amount FLOAT, flow_id INTEGER, "
                "flow_link_source VARCHAR(8))"
            )
        )
        conn.execute(text("CREATE INDEX ix_transactions_flow_id ON transactions (flow_id)"))
        conn.execute(text("INSERT INTO transfer_flows (id) VALUES (195)"))
        conn.execute(
            text(
                "INSERT INTO transactions (id, amount, flow_id, flow_link_source) VALUES "
                "(9104, 200.0, 195, 'MANUAL'), (9316, 555.0, 195, 'MANUAL'), (1, -3.0, NULL, NULL)"
            )
        )

        _apply(conn=conn, load_migration=load_migration, monkeypatch=monkeypatch, step="upgrade")

        inspector = inspect(conn)
        assert set(inspector.get_table_names()) == {"related_groups", "transactions"}
        assert {column["name"] for column in inspector.get_columns("transactions")} == {
            "id",
            "amount",
            "related_group_id",
            "related_link_source",
        }
        assert [(index["name"], index["column_names"]) for index in inspector.get_indexes("transactions")] == [
            ("ix_transactions_related_group_id", ["related_group_id"])
        ]
        assert conn.execute(text("SELECT id FROM related_groups")).scalars().all() == [195]
        rows = conn.execute(
            text("SELECT id, related_group_id, related_link_source FROM transactions ORDER BY id")
        ).all()
        assert rows == [(1, None, None), (9104, 195, "MANUAL"), (9316, 195, "MANUAL")]

        _apply(conn=conn, load_migration=load_migration, monkeypatch=monkeypatch, step="downgrade")

        inspector = inspect(conn)
        assert set(inspector.get_table_names()) == {"transfer_flows", "transactions"}
        assert [(index["name"], index["column_names"]) for index in inspector.get_indexes("transactions")] == [
            ("ix_transactions_flow_id", ["flow_id"])
        ]
        rows = conn.execute(text("SELECT id, flow_id, flow_link_source FROM transactions ORDER BY id")).all()
        assert rows == [(1, None, None), (9104, 195, "MANUAL"), (9316, 195, "MANUAL")]
