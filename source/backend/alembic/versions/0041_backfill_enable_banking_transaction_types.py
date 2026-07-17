"""Backfill transaction_type for Enable Banking transactions

The Enable Banking handler never set a transaction_type, leaving NULL. NULL-typed
transactions are invisible to transfer detection, so EB transfers were never linked.
Backfill from the amount sign, same derivation the handler uses now. Scoped to
ENABLE_BANKING credentials so unmapped Trade Republic/DFS labels stay NULL.

Revision ID: 0041
Revises: 0040
Create Date: 2026-07-17 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0041"
down_revision: Union[str, None] = "0040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE transactions
        SET transaction_type = CASE
            WHEN amount > 0 THEN 'INCOMING'
            WHEN amount < 0 THEN 'OUTGOING'
            ELSE 'ZERO'
        END
        WHERE transaction_type IS NULL
          AND account_id IN (
            SELECT accounts.id
            FROM accounts
            JOIN credentials ON accounts.credential_id = credentials.id
            WHERE credentials.bank = 'ENABLE_BANKING'
          )
        """)


def downgrade() -> None:
    pass
