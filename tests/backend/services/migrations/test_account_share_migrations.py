from collections.abc import Callable
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, Engine, inspect, text
from sqlalchemy.exc import IntegrityError

ALL_REVISIONS = (62, 63, 64, 65)


def _create_referenced_tables(conn: Connection) -> None:
    conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
    conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY)"))
    conn.execute(text("CREATE TABLE account_groups (id INTEGER PRIMARY KEY)"))
    conn.execute(text("INSERT INTO users (id) VALUES (1), (2)"))
    conn.execute(text("INSERT INTO accounts (id) VALUES (7)"))
    conn.execute(text("INSERT INTO account_groups (id) VALUES (3)"))


def _apply(
    revisions: tuple[int, ...],
    conn: Connection,
    load_migration: Callable[[int], ModuleType],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operations = Operations(MigrationContext.configure(connection=conn))
    for revision in revisions:
        migration = load_migration(revision)
        monkeypatch.setattr(target=migration, name="op", value=operations)
        migration.upgrade()


def test_a_share_written_by_0062_survives_the_later_revisions(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    with migration_test_engine.begin() as conn:
        _create_referenced_tables(conn)
        _apply(revisions=(62,), conn=conn, load_migration=load_migration, monkeypatch=monkeypatch)
        conn.execute(
            text(
                "INSERT INTO account_shares (id, account_id, user_id, permission, status) "
                "VALUES (1, 7, 1, 'WRITE', 'ACCEPTED')"
            )
        )

        _apply(revisions=(63, 64, 65), conn=conn, load_migration=load_migration, monkeypatch=monkeypatch)

        row = conn.execute(
            text(
                "SELECT permission, status, display_name, balance_factor, is_hidden, include_by_default, "
                "group_id, position FROM account_shares"
            )
        ).one()
        assert tuple(row) == ("WRITE", "ACCEPTED", None, 100.0, 0, 1, None, 0)


def test_the_finished_table_has_the_columns_keys_and_indexes_the_model_expects(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    with migration_test_engine.begin() as conn:
        _create_referenced_tables(conn)
        _apply(revisions=ALL_REVISIONS, conn=conn, load_migration=load_migration, monkeypatch=monkeypatch)

        inspector = inspect(conn)
        columns = {column["name"]: column for column in inspector.get_columns("account_shares")}
        assert set(columns) == {
            "id",
            "account_id",
            "user_id",
            "permission",
            "status",
            "display_name",
            "balance_factor",
            "is_hidden",
            "include_by_default",
            "group_id",
            "position",
        }
        assert [name for name, column in columns.items() if not column["nullable"] and column["default"] is None] == [
            "id",
            "account_id",
            "user_id",
            "permission",
            "status",
        ]

        foreign_keys = {
            fk["constrained_columns"][0]: (fk["referred_table"], fk["options"].get("ondelete"))
            for fk in inspector.get_foreign_keys("account_shares")
        }
        assert foreign_keys == {
            "account_id": ("accounts", "CASCADE"),
            "user_id": ("users", "CASCADE"),
            "group_id": ("account_groups", "SET NULL"),
        }
        assert [(index["name"], index["column_names"]) for index in inspector.get_indexes("account_shares")] == [
            ("ix_account_shares_account_id", ["account_id"]),
            ("ix_account_shares_user_id", ["user_id"]),
        ]

        conn.execute(
            text(
                "INSERT INTO account_shares (id, account_id, user_id, permission, status) "
                "VALUES (1, 7, 1, 'READ', 'PENDING')"
            )
        )
        with pytest.raises(IntegrityError):
            conn.execute(
                text(
                    "INSERT INTO account_shares (id, account_id, user_id, permission, status) "
                    "VALUES (2, 7, 1, 'WRITE', 'PENDING')"
                )
            )
