"""Add Contract.note (user-editable free-text)

Revision ID: 0036
Revises: 0035
Create Date: 2026-07-02 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: Union[str, None] = "0035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.add_column(sa.Column("note", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contracts") as batch:
        batch.drop_column("note")
