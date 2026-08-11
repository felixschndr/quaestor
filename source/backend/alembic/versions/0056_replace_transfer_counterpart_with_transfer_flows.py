"""Replace the 1:1 transfer_counterpart_id link with N:N transfer_flows (Geldfluss)

Revision ID: 0056
Revises: 0055
Create Date: 2026-08-11 12:00:00.000000
"""

from collections import defaultdict
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0056"
down_revision: Union[str, None] = "0055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_INDEX = "uq_transactions_transfer_counterpart_id"
_NEW_INDEX = "ix_transactions_flow_id"


def upgrade() -> None:
    op.create_table(
        "transfer_flows",
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    op.add_column("transactions", sa.Column("flow_id", sa.Integer(), nullable=True))
    op.create_index(_NEW_INDEX, "transactions", ["flow_id"], unique=False)

    _backfill_flows_from_pairs()

    op.drop_index(_OLD_INDEX, table_name="transactions")
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("transfer_counterpart_id")


def downgrade() -> None:
    op.add_column("transactions", sa.Column("transfer_counterpart_id", sa.Integer(), nullable=True))
    _backfill_pairs_from_flows()
    op.create_index(_OLD_INDEX, "transactions", ["transfer_counterpart_id"], unique=True)

    op.drop_index(_NEW_INDEX, table_name="transactions")
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("flow_id")
    op.drop_table("transfer_flows")


def _backfill_flows_from_pairs() -> None:
    connection = op.get_bind()
    links = {
        row[0]: row[1]
        for row in connection.execute(
            sa.text("SELECT id, transfer_counterpart_id FROM transactions WHERE transfer_counterpart_id IS NOT NULL")
        )
    }
    seen: set[int] = set()
    next_flow_id = 1
    for transaction_id, counterpart_id in links.items():
        if transaction_id in seen:
            continue
        seen.add(transaction_id)

        if links.get(counterpart_id) != transaction_id:
            # Only migrate symmetric, intact pairs; orphaned or one-sided links stay unlinked; should never happen
            continue

        seen.add(counterpart_id)
        connection.execute(sa.text("INSERT INTO transfer_flows (id) VALUES (:flow_id)"), {"flow_id": next_flow_id})
        connection.execute(
            sa.text("UPDATE transactions SET flow_id = :flow_id WHERE id = :a OR id = :b"),
            {"flow_id": next_flow_id, "a": transaction_id, "b": counterpart_id},
        )
        next_flow_id += 1


def _backfill_pairs_from_flows() -> None:
    # must be lossy (N:N can't be mapped to 1:1)
    connection = op.get_bind()
    members: dict[int, list[int]] = defaultdict(list)
    for flow_id, transaction_id in connection.execute(
        sa.text("SELECT flow_id, id FROM transactions WHERE flow_id IS NOT NULL")
    ):
        members[flow_id].append(transaction_id)
    for ids in members.values():
        if len(ids) != 2:
            continue
        first, second = ids
        connection.execute(
            sa.text("UPDATE transactions SET transfer_counterpart_id = :other WHERE id = :self"),
            {"other": second, "self": first},
        )
        connection.execute(
            sa.text("UPDATE transactions SET transfer_counterpart_id = :other WHERE id = :self"),
            {"other": first, "self": second},
        )
