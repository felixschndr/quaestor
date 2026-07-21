"""Add notification_rules.days

Revision ID: 0042
Revises: 0041
Create Date: 2026-07-21 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0042"
down_revision: Union[str, None] = "0041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notification_rules", sa.Column("days", sa.Integer(), nullable=True))
    op.execute("UPDATE notification_rules SET days = 5 WHERE trigger = 'CONTRACT_OVERDUE'")


def downgrade() -> None:
    op.drop_column("notification_rules", "days")
