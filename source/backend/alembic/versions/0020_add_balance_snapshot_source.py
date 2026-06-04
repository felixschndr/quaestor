"""Add account_balance_snapshots.source

Snapshots are now either COMPUTED (derived by walking the balance over transactions) or BANK_REPORTED
(an MT940 opening/closing balance the bank handed us). Bank-reported snapshots are treated as ground
truth and survive a recompute.

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-04 09:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("account_balance_snapshots") as batch_op:
        batch_op.add_column(
            sa.Column(
                "source",
                sa.Enum("COMPUTED", "BANK_REPORTED", name="balancesnapshotsource"),
                nullable=False,
                server_default="COMPUTED",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("account_balance_snapshots") as batch_op:
        batch_op.drop_column("source")
