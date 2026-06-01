"""Add transactions.transfer_counterpart_id for detected inter-account transfers

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-01 09:10:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX_NAME = "uq_transactions_transfer_counterpart_id"


def upgrade() -> None:
    op.add_column("transactions", sa.Column("transfer_counterpart_id", sa.Integer(), nullable=True))
    op.create_index(_INDEX_NAME, "transactions", ["transfer_counterpart_id"], unique=True)


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="transactions")
    op.drop_column("transactions", "transfer_counterpart_id")
