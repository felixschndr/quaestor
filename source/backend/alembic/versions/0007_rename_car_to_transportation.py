"""Broaden TransactionCategory.CAR to TransactionCategory.TRANSPORTATION

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-27 20:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
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

_OLD = _BASE_VALUES + ("CAR",)
_NEW = _BASE_VALUES + ("TRANSPORTATION",)
_BOTH = _BASE_VALUES + ("CAR", "TRANSPORTATION")


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
    op.execute("UPDATE transactions SET category = 'TRANSPORTATION' WHERE category = 'CAR'")
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
    op.execute("UPDATE transactions SET category = 'CAR' WHERE category = 'TRANSPORTATION'")
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column(
            "category",
            existing_type=_enum(*_BOTH),
            type_=_enum(*_OLD),
            existing_server_default="UNKNOWN",
        )
