"""no-op


Revision ID: 0053
Revises: 0052
Create Date: 2026-08-06 15:30:00.000000
"""

from typing import Sequence, Union

revision: str = "0053"
down_revision: Union[str, None] = "0052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
