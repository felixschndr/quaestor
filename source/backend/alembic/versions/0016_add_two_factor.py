"""Add TOTP two-factor authentication

Revision ID: 0016
Revises: 0015

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("two_factor_secret", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default="0"))

    op.create_table(
        "backup_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_backup_codes_user_id", "backup_codes", ["user_id"])

    op.create_table(
        "two_factor_challenges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_two_factor_challenges_token_hash", "two_factor_challenges", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_two_factor_challenges_token_hash", table_name="two_factor_challenges")
    op.drop_table("two_factor_challenges")
    op.drop_index("ix_backup_codes_user_id", table_name="backup_codes")
    op.drop_table("backup_codes")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("two_factor_enabled")
        batch_op.drop_column("two_factor_secret")
