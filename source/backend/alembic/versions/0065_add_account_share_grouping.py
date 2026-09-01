"""Give each account share its own group and position

Revision ID: 0065
Revises: 0064
Create Date: 2026-09-01 14:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: Union[str, None] = "0064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("account_shares") as batch_op:
        batch_op.add_column(sa.Column("group_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
        batch_op.create_foreign_key(
            "fk_account_shares_group_id",
            "account_groups",
            ["group_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("account_shares") as batch_op:
        batch_op.drop_constraint("fk_account_shares_group_id", type_="foreignkey")
        batch_op.drop_column("position")
        batch_op.drop_column("group_id")
