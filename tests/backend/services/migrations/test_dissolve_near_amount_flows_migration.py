from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text


def test_dissolves_only_flows_within_the_one_euro_tolerance(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    migration = load_migration(58)
    with migration_test_engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, amount REAL, flow_id INTEGER, "
                "transaction_type TEXT, transfer_original_type TEXT, flow_link_source TEXT)"
            )
        )
        conn.execute(text("CREATE TABLE transfer_flows (id INTEGER PRIMARY KEY)"))
        conn.execute(text("INSERT INTO transfer_flows (id) VALUES (1), (2), (3)"))
        conn.execute(
            text(
                "INSERT INTO transactions (id, amount, flow_id, transaction_type, transfer_original_type, "
                "flow_link_source) VALUES "
                # flow 1: 0.90 EUR apart -> tolerance artifact -> dissolve
                "(10, -2.90, 1, 'TRANSFER_OUT', 'OUTGOING', 'DETECTED'), "
                "(11,  2.00, 1, 'TRANSFER_IN',  'INCOMING', 'DETECTED'), "
                # flow 2: 80.40 EUR apart -> deliberate (expense + partial refund) -> keep
                "(20, -120.40, 2, 'TRANSFER_OUT', 'OUTGOING', 'DETECTED'), "
                "(21,   40.00, 2, 'TRANSFER_IN',  'INCOMING', 'DETECTED'), "
                # flow 3: exact match -> keep
                "(30, -50.00, 3, 'TRANSFER_OUT', 'OUTGOING', 'DETECTED'), "
                "(31,  50.00, 3, 'TRANSFER_IN',  'INCOMING', 'DETECTED')"
            )
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration._dissolve_near_amount_flows()

        rows = {
            r[0]: r
            for r in conn.execute(
                text("SELECT id, flow_id, transaction_type, transfer_original_type, flow_link_source FROM transactions")
            )
        }
        # flow 1 dissolved: unlinked, type restored, markers cleared
        assert rows[10][1] is None and rows[11][1] is None
        assert rows[10][2] == "OUTGOING" and rows[11][2] == "INCOMING"
        assert rows[10][3] is None and rows[10][4] is None
        # flows 2 and 3 untouched
        assert rows[20][1] == 2 and rows[21][1] == 2 and rows[20][2] == "TRANSFER_OUT"
        assert rows[30][1] == 3 and rows[31][1] == 3
        # only the dissolved flow's row is gone
        assert {r[0] for r in conn.execute(text("SELECT id FROM transfer_flows"))} == {2, 3}
