"""Add MARKET_VALUED balance snapshots and drop accounts.tracks_balance_history

Depot positions (Trade Republic) and fund accounts (DFS) are now valued daily as quantity x price
and stored as MARKET_VALUED snapshots, so the per-account tracks_balance_history flag is obsolete:
every account gets a history, either market-valued or transaction-walked.

Existing snapshots are wiped because DFS funds carried transaction-walked balances that ignored
market value, and every market series is rebuilt from scratch on the next sync. Clearing
last_fetching_timestamp forces that full re-sync.

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-04 20:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_SOURCE_ENUM = sa.Enum("COMPUTED", "BANK_REPORTED", name="balancesnapshotsource")
_NEW_SOURCE_ENUM = sa.Enum("COMPUTED", "BANK_REPORTED", "MARKET_VALUED", name="balancesnapshotsource")


def upgrade() -> None:
    with op.batch_alter_table("account_balance_snapshots") as batch_op:
        batch_op.alter_column("source", existing_type=_OLD_SOURCE_ENUM, type_=_NEW_SOURCE_ENUM, existing_nullable=False)
    op.drop_column("accounts", "tracks_balance_history")
    op.execute("DELETE FROM account_balance_snapshots")
    op.execute("UPDATE credentials SET last_fetching_timestamp = NULL")


def downgrade() -> None:
    op.add_column("accounts", sa.Column("tracks_balance_history", sa.Boolean(), nullable=False, server_default="1"))
    op.execute("DELETE FROM account_balance_snapshots WHERE source = 'MARKET_VALUED'")
    with op.batch_alter_table("account_balance_snapshots") as batch_op:
        batch_op.alter_column("source", existing_type=_NEW_SOURCE_ENUM, type_=_OLD_SOURCE_ENUM, existing_nullable=False)
