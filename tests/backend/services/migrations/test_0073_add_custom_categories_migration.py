from collections.abc import Callable
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Engine, inspect, text

REVISION = 73
CUSTOM_KEY = "CUSTOM_0A1B2C3D"


def test_downgrade_uncategorizes_what_carried_a_custom_category_before_dropping_them(
    monkeypatch: pytest.MonkeyPatch, load_migration: Callable[[int], ModuleType], migration_test_engine: Engine
):
    with migration_test_engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        for table in ("transactions", "recurring_transactions", "contracts", "category_rules"):
            conn.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, category VARCHAR)"))
            conn.execute(
                statement=text(f"INSERT INTO {table} (id, category) VALUES (1, :key), (2, 'FUEL')"),  # nosec B608
                parameters={"key": CUSTOM_KEY},
            )
        migration = load_migration(REVISION)
        monkeypatch.setattr(target=migration, name="op", value=Operations(MigrationContext.configure(connection=conn)))
        migration.upgrade()
        conn.execute(
            statement=text(
                'INSERT INTO custom_categories (key, user_id, "group", name, created_at) '
                "VALUES (:key, 1, 'PETS', 'Futter', '2026-09-15 00:00:00')"
            ),
            parameters={"key": CUSTOM_KEY},
        )

        migration.downgrade()

        assert "custom_categories" not in inspect(conn).get_table_names()
        for table in ("transactions", "recurring_transactions", "contracts", "category_rules"):
            rows = conn.execute(text(f"SELECT id, category FROM {table} ORDER BY id")).all()  # nosec B608
            assert rows == [(1, "UNKNOWN"), (2, "FUEL")], table
