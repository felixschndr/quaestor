"""Add transactions.recurring_transaction_id

Links a booked transaction back to the recurring rule that created it.

Revision ID: 0025
Revises: 0024
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.add_column(sa.Column("recurring_transaction_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_transactions_recurring_transaction_id",
            "recurring_transactions",
            ["recurring_transaction_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_constraint("fk_transactions_recurring_transaction_id", type_="foreignkey")
        batch_op.drop_column("recurring_transaction_id")
