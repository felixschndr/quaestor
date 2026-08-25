"""Backfill the account holder as the counterparty on existing PayPal payouts

New syncs label a PayPal balance payout with the account holder's name.

Revision ID: 0061
Revises: 0060
Create Date: 2026-08-25 15:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: Union[str, None] = "0060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE transactions SET other_party = "
            "(SELECT accounts.name FROM accounts WHERE accounts.id = transactions.account_id) "
            "WHERE amount < 0 "
            "AND (other_party IS NULL OR other_party = '') "
            "AND (purpose IS NULL OR purpose = '') "
            "AND account_id IN ("
            "SELECT accounts.id FROM accounts "
            "JOIN credentials ON credentials.id = accounts.credential_id "
            "WHERE json_extract(credentials.credentials, '$.aspsp_name') = 'PayPal')"
        )
    )


def downgrade() -> None:
    pass
