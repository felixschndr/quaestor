"""Give each account share its own display name and balance factor

Revision ID: 0063
Revises: 0062
Create Date: 2026-09-01 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0063"
down_revision: Union[str, None] = "0062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("account_shares", sa.Column("display_name", sa.String(length=150), nullable=True))
    op.add_column("account_shares", sa.Column("balance_factor", sa.Float(), nullable=False, server_default="100.0"))


def downgrade() -> None:
    op.drop_column("account_shares", "balance_factor")
    op.drop_column("account_shares", "display_name")
