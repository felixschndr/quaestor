"""Give manually linked depot legs their BUY/SELL type back

Linking a depot buy or sell by hand turned it into a transfer, while detected links keep the original type there. The
depot sign-flip depends on that type, so manually linked buys showed up as negative on the depot.

Revision ID: 0075
Revises: 0074
Create Date: 2026-10-13 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0075"
down_revision: Union[str, None] = "0074"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE transactions SET "
            "transaction_type = transfer_original_type, "
            "transfer_original_type = NULL "
            "WHERE related_link_source = 'MANUAL' "
            "AND transfer_original_type IS NOT NULL "
            "AND account_id IN (SELECT account_id FROM account_balance_snapshots WHERE source = 'MARKET_VALUED')"
        )
    )


def downgrade() -> None:
    pass
