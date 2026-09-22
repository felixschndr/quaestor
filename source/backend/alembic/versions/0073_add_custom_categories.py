"""Let users add their own subcategories to the fixed category groups

Category columns already are plain VARCHARs, so a custom category's key fits in them without a schema change.
A downgrade drops the table, so everything that carried such a key becomes uncategorized.

Revision ID: 0073
Revises: 0072
Create Date: 2026-09-15 18:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0073"
down_revision: Union[str, None] = "0072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "custom_categories",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "group", "name", name="uq_custom_categories_user_group_name"),
    )
    op.create_index("ix_custom_categories_user_id", "custom_categories", ["user_id"], unique=False)


def downgrade() -> None:
    connection = op.get_bind()
    for table in ("transactions", "recurring_transactions", "contracts", "category_rules"):
        connection.execute(
            sa.text(
                f"UPDATE {table} SET category = 'UNKNOWN' "  # nosec B608
                "WHERE category IN (SELECT key FROM custom_categories)"
            )
        )
    op.drop_index("ix_custom_categories_user_id", table_name="custom_categories")
    op.drop_table("custom_categories")
