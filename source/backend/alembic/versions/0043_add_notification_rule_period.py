"""Add notification_rules.period

Revision ID: 0043
Revises: 0042
Create Date: 2026-07-21 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0043"
down_revision: Union[str, None] = "0042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notification_rules", sa.Column("period", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("notification_rules", "period")
