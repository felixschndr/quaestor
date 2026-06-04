"""Rename TransactionType.UNKNOWN to TransactionType.ZERO

UNKNOWN was only ever assigned by the FinTS handler for amount == 0 (a
"Nullgeschäft"); ZERO names that meaning explicitly. The transaction_type
columns are plain VARCHAR (no CHECK constraint on the enum), so a value update
is all that's required — no column-type migration.

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-04 14:30:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Both columns store a TransactionType value.
    op.execute("UPDATE transactions SET transaction_type = 'ZERO' WHERE transaction_type = 'UNKNOWN'")
    op.execute("UPDATE transactions SET transfer_original_type = 'ZERO' WHERE transfer_original_type = 'UNKNOWN'")


def downgrade() -> None:
    op.execute("UPDATE transactions SET transaction_type = 'UNKNOWN' WHERE transaction_type = 'ZERO'")
    op.execute("UPDATE transactions SET transfer_original_type = 'UNKNOWN' WHERE transfer_original_type = 'ZERO'")
