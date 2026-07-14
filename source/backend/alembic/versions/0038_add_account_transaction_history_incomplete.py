"""Add accounts.transaction_history_incomplete

Some PSD2 accounts (e.g. PayPal) don't report every balance movement as a transaction
(automatic bank funding is missing), so their balance history must not be derived from
the transaction stream.

Revision ID: 0038
Revises: 0037
Create Date: 2026-07-14 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0038"
down_revision: Union[str, None] = "0037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("transaction_history_incomplete", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("accounts", "transaction_history_incomplete")
