"""Add FIN4U to bankprovider enum

Adds the fin4u Altersvorsorge provider to the credentials.bank CHECK constraint
so new credentials can be created with bank='FIN4U'.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-27 21:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OLD_VALUES = ("ING", "DKB", "DFS", "TRADE_REPUBLIC", "MANUAL")
_NEW_VALUES = _OLD_VALUES + ("FIN4U",)


def upgrade() -> None:
    with op.batch_alter_table("credentials") as batch_op:
        batch_op.alter_column(
            "bank",
            existing_type=sa.Enum(*_OLD_VALUES, name="bankprovider"),
            type_=sa.Enum(*_NEW_VALUES, name="bankprovider"),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("credentials") as batch_op:
        batch_op.alter_column(
            "bank",
            existing_type=sa.Enum(*_NEW_VALUES, name="bankprovider"),
            type_=sa.Enum(*_OLD_VALUES, name="bankprovider"),
            existing_nullable=False,
        )
