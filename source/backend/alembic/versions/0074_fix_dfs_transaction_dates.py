"""Move DFS transactions to the day DFS booked them and turn unsettled fund switches into pending ones

DFS sends each day as midnight German time, which was read as UTC and so landed on the previous day. Syncs now read
it as German time; without moving the stored transactions, the next sync would add every fetched one again under its
corrected date. Market values are rewritten on every sync and need no migration.

Revision ID: 0074
Revises: 0073
Create Date: 2026-09-24 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0074"
down_revision: Union[str, None] = "0073"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Only what DFS delivered; expected and recurring transactions carry a date the user picked
    op.get_bind().execute(
        sa.text(
            "UPDATE transactions SET "
            "date = date(date, '+1 day'), "
            "pending = CASE WHEN amount = 0 THEN 1 ELSE pending END "
            "WHERE expected = 0 "
            "AND recurring_transaction_id IS NULL "
            "AND account_id IN ("
            "SELECT accounts.id FROM accounts "
            "JOIN credentials ON credentials.id = accounts.credential_id "
            "WHERE credentials.bank = 'DFS')"
        )
    )


def downgrade() -> None:
    pass
