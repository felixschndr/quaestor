"""Give every user the contract-ending and charged-after-end notification rules

Revision ID: 0052
Revises: 0051
Create Date: 2026-08-03 15:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0052"
down_revision: Union[str, None] = "0051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TRIGGERS = ("CONTRACT_ENDING", "CONTRACT_CHARGED_AFTER_END")


def upgrade() -> None:
    # _TRIGGERS are hardcoded constants, not user input, so the f-string interpolation is safe.
    for trigger in _TRIGGERS:
        op.execute(f"""
            INSERT INTO notification_rules (
                user_id, enabled, include_content, trigger, account_ids, categories, types
            )
            SELECT users.id, 1, 1, '{trigger}', '[]', '[]', '[]'
            FROM users
            WHERE NOT EXISTS (
                SELECT 1 FROM notification_rules
                WHERE notification_rules.user_id = users.id AND notification_rules.trigger = '{trigger}'
            )
            """)  # nosec B608


def downgrade() -> None:
    for trigger in _TRIGGERS:
        op.execute(f"DELETE FROM notification_rules WHERE trigger = '{trigger}'")  # nosec B608
