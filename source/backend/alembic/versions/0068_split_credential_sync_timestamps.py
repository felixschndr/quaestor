"""Rename last_fetching_timestamp to last_successful_sync_timestamp and add last_sync_attempt_timestamp

Revision ID: 0068
Revises: 0067
Create Date: 2026-09-06 11:14:33.208915
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0068"
down_revision: Union[str, None] = "0067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("credentials", schema=None) as batch_op:
        batch_op.alter_column("last_fetching_timestamp", new_column_name="last_successful_sync_timestamp")
        batch_op.add_column(sa.Column("last_sync_attempt_timestamp", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE credentials SET last_sync_attempt_timestamp = last_successful_sync_timestamp")


def downgrade() -> None:
    with op.batch_alter_table("credentials", schema=None) as batch_op:
        batch_op.drop_column("last_sync_attempt_timestamp")
        batch_op.alter_column("last_successful_sync_timestamp", new_column_name="last_fetching_timestamp")
