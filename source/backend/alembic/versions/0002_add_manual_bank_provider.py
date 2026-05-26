"""Add MANUAL to bankprovider enum

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-26 14:50:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OLD_VALUES = ("ING", "DKB", "DFS", "TRADE_REPUBLIC")
_NEW_VALUES = _OLD_VALUES + ("MANUAL",)


def upgrade() -> None:
    # SQLite enforces the enum via a CHECK constraint with the listed members.
    # Altering it requires a full table copy (batch_alter_table is alembic's
    # SQLite-safe wrapper for that). We swap the old constraint for the new
    # one that additionally allows "MANUAL".
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
