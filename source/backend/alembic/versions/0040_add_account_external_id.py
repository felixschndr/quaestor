"""Add accounts.external_id

Revision ID: 0040
Revises: 0039
Create Date: 2026-07-16 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0040"
down_revision: Union[str, None] = "0039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("external_id", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "external_id")
