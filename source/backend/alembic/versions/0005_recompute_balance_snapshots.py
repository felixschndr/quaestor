"""Drop all account_balance_snapshots so they get rebuilt cleanly

Older snapshots include the bank-reported balance walked backward over future-dated transactions, which left every
historical snapshot offset. Easiest fix: wipe the snapshot table, then let the next sync rebuild it from scratch.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-27 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM account_balance_snapshots")


def downgrade() -> None:
    # No-op: snapshots are derivable from transactions + account.balance, so
    # there's nothing to restore on downgrade.
    pass
