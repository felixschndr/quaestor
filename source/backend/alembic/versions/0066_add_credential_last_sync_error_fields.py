"""Add credential last_sync_error fields

Revision ID: 0066
Revises: 0065
Create Date: 2026-09-03 16:38:47.397574
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: Union[str, None] = "0065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("credentials", schema=None) as batch_op:
        batch_op.add_column(sa.Column("last_sync_error", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "last_sync_error_code",
                sa.Enum(
                    "CANCELLED",
                    "INVALID_CREDENTIALS",
                    "UNSUPPORTED_BANK",
                    "RATE_LIMITED",
                    "REDIRECT_URL_NOT_ALLOWED",
                    "APPLICATION_NOT_ACTIVATED",
                    "UNKNOWN",
                    name="joberrorcode",
                ),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("credentials", schema=None) as batch_op:
        batch_op.drop_column("last_sync_error_code")
        batch_op.drop_column("last_sync_error")
