"""Add TransactionCategory.DEPOSIT (mirrors WITHDRAWAL)

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-06 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0023"
down_revision: Union[str, None] = "0022"
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
)
_NEW = _OLD + ("DEPOSIT",)


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


def downgrade() -> None:
    # Fold any DEPOSIT rows back into SAVINGS (its pre-split categorization)
    # before narrowing the constraint so no value violates it.
    op.execute("UPDATE transactions SET category = 'SAVINGS' WHERE category = 'DEPOSIT'")
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_NEW),
            type_=_enum(*_OLD),
            existing_server_default="UNKNOWN",
        )
