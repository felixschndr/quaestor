"""Archive already sold depot positions

Sold positions are now archived (is_hidden) automatically. Positions closed before that still sit at 0 in the overview.

Revision ID: 0076
Revises: 0075
Create Date: 2026-10-22 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0076"
down_revision: Union[str, None] = "0075"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE accounts SET is_hidden = 1 "
            "WHERE balance = 0 "
            "AND id IN (SELECT account_id FROM account_balance_snapshots WHERE source = 'MARKET_VALUED')"
        )
    )


def downgrade() -> None:
    pass
