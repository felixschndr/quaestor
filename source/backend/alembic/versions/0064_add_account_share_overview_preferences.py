"""Give each account share its own overview preferences

Revision ID: 0064
Revises: 0063
Create Date: 2026-09-01 13:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: Union[str, None] = "0063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("account_shares", sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("account_shares", sa.Column("include_by_default", sa.Boolean(), nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("account_shares", "include_by_default")
    op.drop_column("account_shares", "is_hidden")
