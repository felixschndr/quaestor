"""Add transactions.transfer_original_type and transfer_relink_blocked

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-01 10:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TRANSACTION_TYPE = sa.Enum(
    "INCOMING",
    "OUTGOING",
    "BUY",
    "SELL",
    "DEPOSIT",
    "REMOVAL",
    "DIVIDEND",
    "INTEREST",
    "INTEREST_CHARGE",
    "TAXES",
    "TAX_REFUND",
    "FEES",
    "FEES_REFUND",
    "SPINOFF",
    "SPLIT",
    "SWAP",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "UNKNOWN",
    name="transactiontype",
    create_type=False,
)


def upgrade() -> None:
    op.add_column("transactions", sa.Column("transfer_original_type", _TRANSACTION_TYPE, nullable=True))
    op.add_column(
        "transactions",
        sa.Column("transfer_relink_blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("transactions", "transfer_relink_blocked")
    op.drop_column("transactions", "transfer_original_type")
