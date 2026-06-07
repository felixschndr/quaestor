"""Add recurring_transactions

Revision ID: 0024
Revises: 0023
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recurring_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=True),
        sa.Column("other_party", sa.String(), nullable=True),
        sa.Column(
            "transaction_type",
            sa.Enum(
                "INCOMING",
                "OUTGOING",
                "BUY",
                "SELL",
                "DEPOSIT",
                "REMOVAL",
                "DIVIDEND",
                "INTEREST",
                "INTEREST_CHARGE",
                "TAXES",
                "TAX_REFUND",
                "FEES",
                "FEES_REFUND",
                "SPINOFF",
                "SPLIT",
                "SWAP",
                "TRANSFER_IN",
                "TRANSFER_OUT",
                "ZERO",
                name="transactiontype",
            ),
            nullable=True,
        ),
        sa.Column(
            "category",
            sa.Enum(
                "SALARY",
                "ALLOWANCE",
                "PENSION",
                "REIMBURSEMENT",
                "INTEREST",
                "INVESTMENT",
                "SUBSCRIPTIONS",
                "RENT",
                "UTILITIES",
                "TRAVEL",
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
                "DEPOSIT",
                "TRANSFER",
                "UNKNOWN",
                name="transactioncategory",
            ),
            nullable=True,
        ),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("frequency", sa.Enum("MONTHLY", "WEEKLY", name="recurrencefrequency"), nullable=False),
        sa.Column("day_of_month", sa.Integer(), nullable=True),
        sa.Column("day_of_week", sa.Integer(), nullable=True),
        sa.Column("next_run_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recurring_transactions_account_id", "recurring_transactions", ["account_id"])
    op.create_index("ix_recurring_transactions_next_run_date", "recurring_transactions", ["next_run_date"])


def downgrade() -> None:
    op.drop_index("ix_recurring_transactions_next_run_date", table_name="recurring_transactions")
    op.drop_index("ix_recurring_transactions_account_id", table_name="recurring_transactions")
    op.drop_table("recurring_transactions")
