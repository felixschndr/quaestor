"""Remove pending/booked duplicate transactions on FinTS accounts

Before pending entries were modelled explicitly, a "Vormerkung" and its later booked
counterpart were stored as two rows and sometimes their date/purpose/other_party drifted apart, so the
old dedup key didn't catch them. This wipes those duplicates. Affected accounts then get their
balance snapshots dropped and their credential's last_fetching_timestamp reset, so the next
sync re-pulls the window and rebuilds running balances cleanly (the new dedup + pending
logic prevents the duplicates from coming back).

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-02 20:45:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Rows to delete: a duplicate is a transaction with a higher-id sibling of the same amount
# within +-4 days, on a FinTS account. Keeping the highest id keeps the most recent capture.
_DUPLICATE_IDS = """
    SELECT t.id
    FROM transactions t
    JOIN transactions s
      ON s.account_id = t.account_id
     AND s.amount = t.amount
     AND s.id > t.id
     AND ABS(julianday(s.date) - julianday(t.date)) <= 4
    JOIN accounts a ON a.id = t.account_id
    JOIN credentials c ON c.id = a.credential_id
    WHERE c.bank = 'FINTS'
"""


def upgrade() -> None:
    bind = op.get_bind()

    affected_accounts = [
        row[0]
        for row in bind.execute(
            sa.text(f"SELECT DISTINCT account_id FROM transactions WHERE id IN ({_DUPLICATE_IDS})")  # nosec B608
        )
    ]

    bind.execute(sa.text(f"DELETE FROM transactions WHERE id IN ({_DUPLICATE_IDS})"))  # nosec B608

    # The raw DELETE bypasses the ORM before_delete hook that nulls transfer links, so clean up
    # any counterpart pointers that now dangle.
    bind.execute(
        sa.text(
            "UPDATE transactions SET transfer_counterpart_id = NULL "
            "WHERE transfer_counterpart_id IS NOT NULL "
            "AND transfer_counterpart_id NOT IN (SELECT id FROM transactions)"
        )
    )

    if affected_accounts:
        ids = ",".join(str(account_id) for account_id in affected_accounts)
        bind.execute(sa.text(f"DELETE FROM account_balance_snapshots WHERE account_id IN ({ids})"))  # nosec B608
        bind.execute(
            sa.text(
                f"UPDATE credentials SET last_fetching_timestamp = NULL "  # nosec B608
                f"WHERE id IN (SELECT credential_id FROM accounts WHERE id IN ({ids}))"
            )
        )


def downgrade() -> None:
    pass
