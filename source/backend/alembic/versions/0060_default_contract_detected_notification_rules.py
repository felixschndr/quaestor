"""Give every user the new-contract-detected notification rule

Revision ID: 0060
Revises: 0059
Create Date: 2026-08-17 11:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0060"
down_revision: Union[str, None] = "0059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO notification_rules (
            user_id, enabled, include_content, trigger, account_ids, categories, types
        )
        SELECT users.id, 1, 1, 'CONTRACT_DETECTED', '[]', '[]', '[]'
        FROM users
        """)


def downgrade() -> None:
    op.execute("DELETE FROM notification_rules WHERE trigger = 'CONTRACT_DETECTED'")
