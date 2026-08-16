"""Restore the original type of transactions left typed as a transfer but no longer in any flow

A transaction unlinked through an old code path kept its TRANSFER_IN/OUT type after its flow_id was cleared.
Transfer detection only considers non-transfer types, so such an orphan can never be re-linked.

Revision ID: 0059
Revises: 0058
Create Date: 2026-08-16 20:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0059"
down_revision: Union[str, None] = "0058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE transactions SET transaction_type = transfer_original_type, transfer_original_type = NULL, "
            "flow_link_source = NULL "
            "WHERE transaction_type IN ('TRANSFER_IN', 'TRANSFER_OUT') "
            "AND flow_id IS NULL AND transfer_original_type IS NOT NULL"
        )
    )


def downgrade() -> None:
    pass
