"""Generalize balance_below trigger to balance_threshold with a direction

Revision ID: 0033
Revises: 0032
Create Date: 2026-06-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: Union[str, None] = "0032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notification_rules", sa.Column("direction", sa.String(), nullable=True))
    # Existing "balance below" rules become threshold rules crossing downwards.
    op.execute("UPDATE notification_rules SET trigger = 'BALANCE_THRESHOLD' WHERE trigger = 'BALANCE_BELOW'")
    op.execute("UPDATE notification_rules SET direction = 'BELOW' WHERE trigger = 'BALANCE_THRESHOLD'")


def downgrade() -> None:
    op.execute("UPDATE notification_rules SET trigger = 'BALANCE_BELOW' WHERE trigger = 'BALANCE_THRESHOLD'")
    op.drop_column("notification_rules", "direction")
