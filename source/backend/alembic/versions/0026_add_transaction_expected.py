"""Add transactions.expected and transactions.match_tolerance_percent

Revision ID: 0026
Revises: 0025
Create Date: 2026-06-11 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column("expected", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "transactions",
        sa.Column("match_tolerance_percent", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transactions", "match_tolerance_percent")
    op.drop_column("transactions", "expected")
