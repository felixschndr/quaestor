"""Add TransactionCategory.SIDE_INCOME (side income)

Revision ID: 0028
Revises: 0027
Create Date: 2026-06-17 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OLD = (
    "SALARY",
    "ALLOWANCE",
    "PENSION",
    "REIMBURSEMENT",
    "INTEREST",
    "INVESTMENT",
    "SUBSCRIPTIONS",
    "RENT",
    "UTILITIES",
    "FUEL",
    "FITNESS",
    "ONLINE_SHOPPING",
    "SUPERMARKET",
    "DRUGSTORE",
    "RESTAURANTS",
    "PERSONAL_CARE",
    "CLOTHING",
    "GIFTS",
    "ENTERTAINMENT",
    "FEES",
    "SAVINGS",
    "WITHDRAWAL",
    "TRANSFER",
    "UNKNOWN",
    "TRAVEL",
    "DEPOSIT",
)
_NEW = _OLD + ("SIDE_INCOME",)


def _enum(*values: str) -> sa.Enum:
    return sa.Enum(*values, name="transactioncategory")


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_OLD),
            type_=_enum(*_NEW),
            existing_server_default="UNKNOWN",
        )
    with op.batch_alter_table("recurring_transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_OLD),
            type_=_enum(*_NEW),
        )


def downgrade() -> None:
    # Fold any SIDE_INCOME rows back into UNKNOWN before narrowing the
    # constraint so no existing value violates it.
    op.execute("UPDATE transactions SET category = 'UNKNOWN' WHERE category = 'SIDE_INCOME'")
    op.execute("UPDATE recurring_transactions SET category = 'UNKNOWN' WHERE category = 'SIDE_INCOME'")
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_NEW),
            type_=_enum(*_OLD),
            existing_server_default="UNKNOWN",
        )
    with op.batch_alter_table("recurring_transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_NEW),
            type_=_enum(*_OLD),
        )
