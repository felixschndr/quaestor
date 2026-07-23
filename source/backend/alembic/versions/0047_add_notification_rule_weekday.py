"""Add notification_rules.weekday

Revision ID: 0047
Revises: 0046
Create Date: 2026-07-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0047"
down_revision: Union[str, None] = "0046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notification_rules", sa.Column("weekday", sa.Integer(), nullable=True))
    op.execute("UPDATE notification_rules SET weekday = 6 WHERE trigger = 'DIGEST' AND period = 'WEEKLY'")


def downgrade() -> None:
    op.drop_column("notification_rules", "weekday")
