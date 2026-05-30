"""Clear all credentials.last_fetching_timestamp to force a full-history re-fetch

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-30 22:50:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE credentials SET last_fetching_timestamp = NULL")


def downgrade() -> None:
    pass
