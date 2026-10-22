from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text


@pytest.fixture
def pre_migration_engine(migration_test_engine: Engine) -> Engine:
    with migration_test_engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE transactions (id INTEGER PRIMARY KEY, transfer_counterpart_id INTEGER, flow_id INTEGER)")
        )
        conn.execute(text("CREATE TABLE transfer_flows (id INTEGER PRIMARY KEY)"))
    return migration_test_engine


def test_backfill_flows_from_pairs_groups_symmetric_pairs(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    pre_migration_engine: Engine,
):
    migration = load_migration(56)
    with pre_migration_engine.begin() as conn:
        # 1<->2 is a proper symmetric pair; 3 points at a missing row (orphan); 4 is unlinked.
        conn.execute(
            text("INSERT INTO transactions (id, transfer_counterpart_id) VALUES (1, 2), (2, 1), (3, 99), (4, NULL)")
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration._backfill_flows_from_pairs()

        flow_ids = {row[0]: row[1] for row in conn.execute(text("SELECT id, flow_id FROM transactions"))}
        assert flow_ids[1] is not None
        assert flow_ids[1] == flow_ids[2]
        assert flow_ids[3] is None
        assert flow_ids[4] is None
        assert conn.execute(text("SELECT count(*) FROM transfer_flows")).scalar() == 1


def test_backfill_pairs_from_flows_only_restores_two_member_flows(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    pre_migration_engine: Engine,
):
    migration = load_migration(56)
    with pre_migration_engine.begin() as conn:
        # Flow 10 has two members (reversible); flow 20 has three (cannot map onto a 1:1 counterpart).
        conn.execute(text("INSERT INTO transactions (id, flow_id) VALUES (1, 10), (2, 10), (3, 20), (4, 20), (5, 20)"))
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration._backfill_pairs_from_flows()

        counterparts = {
            row[0]: row[1] for row in conn.execute(text("SELECT id, transfer_counterpart_id FROM transactions"))
        }
        assert counterparts[1] == 2
        assert counterparts[2] == 1
        assert counterparts[3] is None
        assert counterparts[4] is None
        assert counterparts[5] is None
