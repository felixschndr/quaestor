"""Rename the account and account share flag is_hidden to is_archived

Revision ID: 0077
Revises: 0076
Create Date: 2026-10-22 18:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0077"
down_revision: Union[str, None] = "0076"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("accounts", "account_shares")


def upgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column("is_hidden", new_column_name="is_archived")


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column("is_archived", new_column_name="is_hidden")
