"""Remember detected contracts the user deleted so detection does not recreate them

Revision ID: 0078
Revises: 0077
Create Date: 2026-10-30 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0078"
down_revision: Union[str, None] = "0077"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "accounts", sa.Column("dismissed_contract_fingerprints", sa.JSON(), nullable=False, server_default="[]")
    )


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch:
        batch.drop_column("dismissed_contract_fingerprints")
