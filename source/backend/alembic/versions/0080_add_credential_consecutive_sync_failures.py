"""Count consecutive failed periodic syncs per credential to notify only after repeated failures

Revision ID: 0080
Revises: 0079
Create Date: 2026-11-17 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0080"
down_revision: Union[str, None] = "0079"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "credentials", sa.Column("consecutive_sync_failures", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    with op.batch_alter_table("credentials") as batch:
        batch.drop_column("consecutive_sync_failures")
