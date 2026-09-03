"""Add notification log

Revision ID: 0067
Revises: 0066
Create Date: 2026-09-03 21:56:48.816883
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: Union[str, None] = "0066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("notification_log", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_notification_log_created_at"), ["created_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_notification_log_user_id"), ["user_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("notification_log", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_notification_log_user_id"))
        batch_op.drop_index(batch_op.f("ix_notification_log_created_at"))

    op.drop_table("notification_log")
