"""Give every user without notification rules the default set

Revision ID: 0044
Revises: 0043
Create Date: 2026-07-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0044"
down_revision: Union[str, None] = "0043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO notification_rules (
            user_id, enabled, include_content, trigger, account_ids, categories, types, period
        )
        SELECT users.id, 1, 1, defaults.trigger, '[]', '[]', '[]', defaults.period
        FROM users
        CROSS JOIN (
            SELECT 'EXPECTED_TRANSACTION' AS trigger, NULL AS period
            UNION ALL SELECT 'UPCOMING_SHORTFALL', NULL
            UNION ALL SELECT 'DUPLICATE_TRANSACTION', NULL
            UNION ALL SELECT 'CONTRACT_OVERDUE', NULL
            UNION ALL SELECT 'CONTRACT_AMOUNT_INCREASED', NULL
            UNION ALL SELECT 'DIGEST', 'WEEKLY'
        ) AS defaults
        WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE notification_rules.user_id = users.id)
        """)


def downgrade() -> None:
    pass
