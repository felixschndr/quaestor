"""Widen accounts.balance_factor to Float (two-decimal percentages)

Revision ID: 0029
Revises: 0028
Create Date: 2026-06-17 21:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.alter_column(
            "balance_factor",
            existing_type=sa.Integer(),
            type_=sa.Float(),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.alter_column(
            "balance_factor",
            existing_type=sa.Float(),
            type_=sa.Integer(),
            existing_nullable=False,
        )
