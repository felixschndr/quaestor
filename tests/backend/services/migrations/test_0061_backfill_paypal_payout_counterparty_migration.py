from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, text

from tests.backend.conftest import DEFAULT_AMOUNT, LARGE_AMOUNT, PERSON_NAME, SECOND_AMOUNT


def test_backfills_only_paypal_balance_payouts(
    monkeypatch: pytest.MonkeyPatch,
    load_migration: Callable[[int], ModuleType],
    migration_test_engine: Engine,
):
    migration = load_migration(61)
    with migration_test_engine.begin() as conn:
        conn.execute(text("CREATE TABLE credentials (id INTEGER PRIMARY KEY, credentials TEXT)"))
        conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, credential_id INTEGER, name TEXT)"))
        conn.execute(
            text(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER, "
                "transaction_type TEXT, other_party TEXT, purpose TEXT, amount REAL)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO credentials (id, credentials) VALUES "
                '(1, \'{"aspsp_name": "PayPal"}\'), '  # PayPal
                "(3, '{}')"  # non-PayPal (e.g. FinTS)
            )
        )
        conn.execute(
            text("INSERT INTO accounts (id, credential_id, name) VALUES (10, 1, :holder), (30, 3, 'Sparkasse')"),
            parameters={"holder": PERSON_NAME},
        )
        conn.execute(
            text(
                "INSERT INTO transactions (id, account_id, transaction_type, other_party, purpose, amount) VALUES "
                "(1, 10, 'REMOVAL',      NULL,   NULL,     :payout), "  # payout still typed REMOVAL -> backfill
                "(2, 10, 'TRANSFER_OUT', '',     '',       :payout), "  # payout re-typed by transfer detection -> backfill
                "(3, 10, 'OUTGOING',     NULL,   NULL,     :payout), "  # payout synced before classifier existed -> backfill
                "(4, 10, 'OUTGOING',     NULL,   'Coffee', :payout), "  # PayPal payment with a purpose -> untouched
                "(5, 10, 'OUTGOING',     'Shop', NULL,     :payout), "  # PayPal payment with a counterparty -> untouched
                "(6, 10, 'INCOMING',     NULL,   NULL,     :incoming), "  # incoming (amount > 0) -> untouched
                "(7, 30, 'REMOVAL',      NULL,   NULL,     :other_payout)"  # non-PayPal removal -> untouched
            ),
            parameters={"payout": -DEFAULT_AMOUNT, "incoming": SECOND_AMOUNT, "other_payout": -LARGE_AMOUNT},
        )
        monkeypatch.setattr(target=migration.op, name="get_bind", value=lambda: conn)

        migration.upgrade()

        rows = {r[0]: r[1] for r in conn.execute(text("SELECT id, other_party FROM transactions"))}
        assert rows[1] == PERSON_NAME
        assert rows[2] == PERSON_NAME
        assert rows[3] == PERSON_NAME
        assert rows[4] is None
        assert rows[5] == "Shop"
        assert rows[6] is None
        assert rows[7] is None
