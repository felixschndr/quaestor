"""Rename TransactionCategory.TRANSPORTATION to TransactionCategory.TRAVEL

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-28 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BASE_VALUES = (
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
)

_OLD = _BASE_VALUES + ("TRANSPORTATION",)
_NEW = _BASE_VALUES + ("TRAVEL",)
_BOTH = _BASE_VALUES + ("TRANSPORTATION", "TRAVEL")


def _enum(*values: str) -> sa.Enum:
    return sa.Enum(*values, name="transactioncategory")


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_OLD),
            type_=_enum(*_BOTH),
            existing_server_default="UNKNOWN",
        )
    op.execute("UPDATE transactions SET category = 'TRAVEL' WHERE category = 'TRANSPORTATION'")
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_BOTH),
            type_=_enum(*_NEW),
            existing_server_default="UNKNOWN",
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_NEW),
            type_=_enum(*_BOTH),
            existing_server_default="UNKNOWN",
        )
    op.execute("UPDATE transactions SET category = 'TRANSPORTATION' WHERE category = 'TRAVEL'")
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_BOTH),
            type_=_enum(*_OLD),
            existing_server_default="UNKNOWN",
        )
