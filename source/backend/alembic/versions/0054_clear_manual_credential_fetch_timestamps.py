"""Clear last_fetching_timestamp on manual credentials

A manual credential never talks to a bank, so a fetch timestamp on one is a claim nobody made.

Revision ID: 0054
Revises: 0053
Create Date: 2026-08-07 13:30:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0054"
down_revision: Union[str, None] = "0053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Raw SQL on purpose: importing the ORM model would couple this migration to whatever the Credential class looks
    # like today rather than to the schema as of this revision.
    op.execute("UPDATE credentials SET last_fetching_timestamp = NULL WHERE bank = 'MANUAL'")


def downgrade() -> None:
    pass  # The cleared timestamps were meaningless; there is nothing to restore.
