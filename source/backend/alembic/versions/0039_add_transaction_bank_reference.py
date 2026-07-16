"""Add transactions.bank_reference

Revision ID: 0039
Revises: 0038
Create Date: 2026-07-16 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: Union[str, None] = "0038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("bank_reference", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("transactions", "bank_reference")
