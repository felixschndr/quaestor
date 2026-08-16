from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text


def test_restores_only_orphaned_transfer_types(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    migration = load_migration(59)
    with migration_test_engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, transaction_type TEXT, "
                "transfer_original_type TEXT, flow_id INTEGER, flow_link_source TEXT)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO transactions (id, transaction_type, transfer_original_type, flow_id, flow_link_source) "
                "VALUES "
                "(1, 'TRANSFER_OUT', 'REMOVAL',  NULL, NULL), "  # orphan with known original -> restore
                "(2, 'TRANSFER_IN',  'INCOMING', 10,   'DETECTED'), "  # still in a flow -> untouched
                "(3, 'OUTGOING',     NULL,       NULL, NULL), "  # normal non-transfer -> untouched
                "(4, 'TRANSFER_OUT', NULL,       NULL, NULL)"  # orphan without original -> can't restore, left alone
            )
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration.upgrade()

        rows = {
            r[0]: r
            for r in conn.execute(
                text("SELECT id, transaction_type, transfer_original_type, flow_id FROM transactions")
            )
        }
        assert rows[1][1] == "REMOVAL" and rows[1][2] is None  # orphan restored, marker cleared
        assert rows[2][1] == "TRANSFER_IN" and rows[2][3] == 10  # linked member untouched
        assert rows[3][1] == "OUTGOING"  # normal transaction untouched
        assert rows[4][1] == "TRANSFER_OUT"  # no original type -> left as-is
