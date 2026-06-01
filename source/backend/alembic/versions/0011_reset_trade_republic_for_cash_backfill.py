"""Reset Trade Republic so the cash settlement account gets a complete ledger

Until now a Trade-Republic buy/sell/dividend was routed *only* to its position account
(by ISIN), so the cash settlement account was missing those movements and its running
balance drifted far into the negative.

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-01 08:10:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DELETE FROM account_balance_snapshots
        WHERE account_id IN (
            SELECT accounts.id
            FROM accounts
            JOIN credentials ON accounts.credential_id = credentials.id
            WHERE credentials.bank = 'TRADE_REPUBLIC'
        )
        """)
    op.execute("UPDATE credentials SET last_fetching_timestamp = NULL WHERE bank = 'TRADE_REPUBLIC'")


def downgrade() -> None:
    pass
