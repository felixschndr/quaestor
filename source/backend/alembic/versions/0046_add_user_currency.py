"""Add display currency to users

Revision ID: 0046
Revises: 0045
Create Date: 2026-07-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0046"
down_revision: Union[str, None] = "0045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="EUR"),
    )


def downgrade() -> None:
    op.drop_column("users", "currency")
