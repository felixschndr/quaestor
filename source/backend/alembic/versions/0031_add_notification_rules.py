"""Add notification_rules table

Revision ID: 0031
Revises: 0030
Create Date: 2026-06-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column(
            "trigger",
            sa.Enum("EXPECTED_TRANSACTION", "TRANSACTION", "BALANCE_BELOW", name="notificationtrigger"),
            nullable=False,
        ),
        sa.Column("account_ids", sa.JSON(), nullable=False),
        sa.Column("other_party_contains", sa.String(), nullable=True),
        sa.Column("categories", sa.JSON(), nullable=False),
        sa.Column("types", sa.JSON(), nullable=False),
        sa.Column("min_amount", sa.Float(), nullable=True),
        sa.Column("max_amount", sa.Float(), nullable=True),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_rules_user_id", "notification_rules", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_rules_user_id", table_name="notification_rules")
    op.drop_table("notification_rules")
