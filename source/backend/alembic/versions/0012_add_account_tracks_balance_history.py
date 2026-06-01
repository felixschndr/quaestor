"""Add accounts.tracks_balance_history and drop stale Trade-Republic snapshots

Market-valued accounts (Trade Republic security positions) carry the current market value as
their balance, so a transaction-derived running balance is meaningless. This flag lets the
balance-snapshot computation skip such accounts. Existing rows default to True (cash-style
accounts); the next Trade-Republic sync flips its security positions to False.

We also drop the existing balance snapshots of all Trade-Republic accounts so the meaningless
ones on security positions disappear immediately instead of lingering until the next sync. The
cash settlement account rebuilds its (correct) snapshots from its full transaction history on
the next sync; security positions stay empty.

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-01 08:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("tracks_balance_history", sa.Boolean(), nullable=False, server_default="1"),
    )
    op.execute("""
        DELETE FROM account_balance_snapshots
        WHERE account_id IN (
            SELECT accounts.id
            FROM accounts
            JOIN credentials ON accounts.credential_id = credentials.id
            WHERE credentials.bank = 'TRADE_REPUBLIC'
        )
        """)


def downgrade() -> None:
    op.drop_column("accounts", "tracks_balance_history")
