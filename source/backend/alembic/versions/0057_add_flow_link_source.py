"""Add transactions.flow_link_source (DETECTED/MANUAL) to track how a leg entered its flow

Revision ID: 0057
Revises: 0056
Create Date: 2026-08-16 18:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0057"
down_revision: Union[str, None] = "0056"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("flow_link_source", sa.String(length=8), nullable=True))
    op.get_bind().execute(sa.text("UPDATE transactions SET flow_link_source = 'DETECTED' WHERE flow_id IS NOT NULL"))


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("flow_link_source")
