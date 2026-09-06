from collections.abc import Callable
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, Engine, inspect, text

REVISION = 68


def _create_credentials_table(conn: Connection) -> None:
    conn.execute(
        text("CREATE TABLE credentials (" "  id INTEGER PRIMARY KEY," "  last_fetching_timestamp DATETIME" ")")
    )


def _apply(conn: Connection, load_migration: Callable[[int], ModuleType], monkeypatch: pytest.MonkeyPatch) -> None:
    operations = Operations(MigrationContext.configure(connection=conn))
    migration = load_migration(REVISION)
    monkeypatch.setattr(target=migration, name="op", value=operations)
    migration.upgrade()


def test_the_fetching_timestamp_is_renamed_and_seeds_the_attempt_timestamp(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    with migration_test_engine.begin() as conn:
        _create_credentials_table(conn)
        conn.execute(
            text("INSERT INTO credentials (id, last_fetching_timestamp) VALUES (1, '2026-09-06 08:00:00'), (2, NULL)")
        )

        _apply(conn=conn, load_migration=load_migration, monkeypatch=monkeypatch)

        columns = {column["name"] for column in inspect(conn).get_columns("credentials")}
        assert "last_fetching_timestamp" not in columns
        assert {"last_successful_sync_timestamp", "last_sync_attempt_timestamp"} <= columns

        rows = conn.execute(
            text("SELECT id, last_successful_sync_timestamp, last_sync_attempt_timestamp FROM credentials ORDER BY id")
        ).all()
        assert rows == [(1, "2026-09-06 08:00:00", "2026-09-06 08:00:00"), (2, None, None)]
