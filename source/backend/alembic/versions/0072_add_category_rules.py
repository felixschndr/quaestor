"""Let users define their own categorization rules and switch off default matchers

Revision ID: 0072
Revises: 0071
Create Date: 2026-09-15 16:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0072"
down_revision: Union[str, None] = "0071"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "category_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pattern", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "pattern", name="uq_category_rules_user_pattern"),
    )
    op.create_index("ix_category_rules_user_id", "category_rules", ["user_id"], unique=False)
    op.add_column("users", sa.Column("disabled_default_matchers", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("disabled_default_matchers")
    op.drop_index("ix_category_rules_user_id", table_name="category_rules")
    op.drop_table("category_rules")
