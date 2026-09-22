import json
from collections.abc import Callable
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, Engine, text

REVISION = 71

OLD_CATEGORIES = [
    "SALARY",
    "ALLOWANCE",
    "PENSION",
    "SIDE_INCOME",
    "REIMBURSEMENT",
    "INTEREST",
    "INVESTMENT",
    "SUBSCRIPTIONS",
    "RENT",
    "UTILITIES",
    "TRAVEL",
    "FUEL",
    "FITNESS",
    "ONLINE_SHOPPING",
    "SUPERMARKET",
    "DRUGSTORE",
    "RESTAURANTS",
    "PERSONAL_CARE",
    "CLOTHING",
    "GIFTS",
    "ENTERTAINMENT",
    "FEES",
    "SAVINGS",
    "WITHDRAWAL",
    "DEPOSIT",
    "TRANSFER",
    "UNKNOWN",
]


def _create_tables(conn: Connection) -> None:
    conn.execute(text("CREATE TABLE contracts (id INTEGER PRIMARY KEY, category VARCHAR)"))
    conn.execute(
        text(
            "CREATE TABLE transactions (id INTEGER PRIMARY KEY, category VARCHAR NOT NULL, "
            "category_source VARCHAR NOT NULL)"
        )
    )
    conn.execute(text("CREATE TABLE recurring_transactions (id INTEGER PRIMARY KEY, category VARCHAR)"))
    conn.execute(text("CREATE TABLE notification_rules (id INTEGER PRIMARY KEY, categories JSON)"))


def _upgrade(conn: Connection, load_migration: Callable[[int], ModuleType], monkeypatch: pytest.MonkeyPatch) -> None:
    migration = load_migration(REVISION)
    monkeypatch.setattr(target=migration, name="op", value=Operations(MigrationContext.configure(connection=conn)))
    migration.upgrade()


def _categories_of_rule(conn: Connection, rule_id: int) -> list[str]:
    return json.loads(
        conn.execute(
            statement=text("SELECT categories FROM notification_rules WHERE id = :id"), parameters={"id": rule_id}
        ).scalar_one()
    )


def test_retired_categories_move_to_their_successors(
    monkeypatch: pytest.MonkeyPatch, load_migration: Callable[[int], ModuleType], migration_test_engine: Engine
):
    with migration_test_engine.begin() as conn:
        _create_tables(conn)
        conn.execute(text("INSERT INTO contracts (id, category) VALUES (1, 'SUBSCRIPTIONS'), (2, 'FITNESS')"))
        conn.execute(
            text(
                "INSERT INTO transactions (id, category, category_source) VALUES "
                "(1, 'TRAVEL', 'MANUAL'), (2, 'SUBSCRIPTIONS', 'CONTRACT'), (3, 'UTILITIES', 'AUTO'), "
                "(4, 'FITNESS', 'CONTRACT')"
            )
        )
        conn.execute(text("INSERT INTO recurring_transactions (id, category) VALUES (1, 'UTILITIES'), (2, NULL)"))

        _upgrade(conn=conn, load_migration=load_migration, monkeypatch=monkeypatch)

        assert conn.execute(text("SELECT id, category FROM contracts ORDER BY id")).all() == [(1, None), (2, "FITNESS")]
        assert conn.execute(text("SELECT id, category, category_source FROM transactions ORDER BY id")).all() == [
            (1, "VACATION", "MANUAL"),
            (2, "ENTERTAINMENT", "AUTO"),
            (3, "OTHER_HOUSING", "AUTO"),
            (4, "FITNESS", "CONTRACT"),
        ]
        assert conn.execute(text("SELECT id, category FROM recurring_transactions ORDER BY id")).all() == [
            (1, "OTHER_HOUSING"),
            (2, None),
        ]


def test_notification_rules_keep_matching_what_they_matched_before(
    monkeypatch: pytest.MonkeyPatch, load_migration: Callable[[int], ModuleType], migration_test_engine: Engine
):
    with migration_test_engine.begin() as conn:
        _create_tables(conn)
        conn.execute(
            statement=text("INSERT INTO notification_rules (id, categories) VALUES (:id, :categories)"),
            parameters=[
                {"id": 1, "categories": json.dumps(OLD_CATEGORIES)},
                {"id": 2, "categories": json.dumps(["SUPERMARKET", "UTILITIES", "ENTERTAINMENT"])},
                {"id": 3, "categories": json.dumps([])},
            ],
        )

        _upgrade(conn=conn, load_migration=load_migration, monkeypatch=monkeypatch)

        assert _categories_of_rule(conn=conn, rule_id=1) == [
            "INCOME",
            "FOOD_AND_DRINK",
            "HOUSING",
            "MOBILITY",
            "LEISURE",
            "SHOPPING",
            "HEALTH",
            "INSURANCE",
            "FINANCES",
            "SAVINGS_AND_INVESTMENTS",
            "CHILDREN",
            "PETS",
            "MISCELLANEOUS",
            "UNKNOWN",
        ]
        assert _categories_of_rule(conn=conn, rule_id=2) == [
            "SUPERMARKET",
            "ELECTRICITY",
            "HEATING",
            "INTERNET_PHONE",
            "BROADCASTING_FEE",
            "ENTERTAINMENT",
            "EVENTS",
            "GAMING",
        ]
        assert _categories_of_rule(conn=conn, rule_id=3) == []
