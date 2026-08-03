"""add contract end_date and ending_notified_at

Revision ID: 0051
Revises: 0050
Create Date: 2026-08-03 14:57:05.553338
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0051"
down_revision: Union[str, None] = "0050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.add_column(sa.Column("end_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("ending_notified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.drop_column("ending_notified_at")
        batch.drop_column("end_date")
