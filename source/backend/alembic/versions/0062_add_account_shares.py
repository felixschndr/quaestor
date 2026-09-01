"""Add account shares

Revision ID: 0062
Revises: 0061
Create Date: 2026-09-01 10:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: Union[str, None] = "0061"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "account_shares",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("permission", sa.Enum("READ", "WRITE", name="sharepermission"), nullable=False),
        sa.Column("status", sa.Enum("PENDING", "ACCEPTED", name="sharestatus"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "user_id", name="uq_account_shares_account_user"),
    )
    op.create_index("ix_account_shares_account_id", "account_shares", ["account_id"])
    op.create_index("ix_account_shares_user_id", "account_shares", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_account_shares_account_id", table_name="account_shares")
    op.drop_index("ix_account_shares_user_id", table_name="account_shares")
    op.drop_table("account_shares")
