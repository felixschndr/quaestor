"""Add notification_rules.digest_last_period_end

Revision ID: 0050
Revises: 0049
Create Date: 2026-08-02 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0050"
down_revision: Union[str, None] = "0049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notification_rules", sa.Column("digest_last_period_end", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("notification_rules", "digest_last_period_end")
