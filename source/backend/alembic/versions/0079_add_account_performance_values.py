"""Store cost basis and previous-close value of market-valued positions for gain/day-trend display

Revision ID: 0079
Revises: 0078
Create Date: 2026-11-08 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0079"
down_revision: Union[str, None] = "0078"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("cost_basis", sa.Float(), nullable=True))
    op.add_column("accounts", sa.Column("previous_close_value", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch:
        batch.drop_column("previous_close_value")
        batch.drop_column("cost_basis")
