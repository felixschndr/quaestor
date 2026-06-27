"""Add contracts table and link transactions to them

Revision ID: 0034
Revises: 0033
Create Date: 2026-06-25 20:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: Union[str, None] = "0033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TRANSACTION_CATEGORY_VALUES = (
    "SALARY",
    "ALLOWANCE",
    "PENSION",
    "SIDE_INCOME",
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
)


def upgrade() -> None:
    op.create_table(
        "contracts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("fingerprint", sa.String(), nullable=True),
        sa.Column(
            "category",
            sa.Enum(*_TRANSACTION_CATEGORY_VALUES, name="transactioncategory"),
            nullable=True,
        ),
        sa.Column("source", sa.Enum("DETECTED", "MANUAL", name="contractsource"), nullable=False),
        sa.Column("median_amount", sa.Float(), nullable=True),
        sa.Column("amount_spread", sa.Float(), nullable=True),
        sa.Column(
            "frequency",
            sa.Enum("WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", name="contractfrequency"),
            nullable=True,
        ),
        sa.Column("interval_days", sa.Integer(), nullable=True),
        sa.Column("expected_next_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "fingerprint", name="uq_contracts_account_fingerprint"),
    )
    op.create_index("ix_contracts_account_id", "contracts", ["account_id"])

    with op.batch_alter_table("transactions") as batch_op:
        batch_op.add_column(sa.Column("contract_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "contract_assignment",
                sa.Enum("AUTO", "MANUAL", "EXCLUDED", name="contractassignment"),
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            "fk_transactions_contract_id",
            "contracts",
            ["contract_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_transactions_contract_id", ["contract_id"])


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_index("ix_transactions_contract_id")
        batch_op.drop_constraint("fk_transactions_contract_id", type_="foreignkey")
        batch_op.drop_column("contract_assignment")
        batch_op.drop_column("contract_id")
    op.drop_index("ix_contracts_account_id", table_name="contracts")
    op.drop_table("contracts")
