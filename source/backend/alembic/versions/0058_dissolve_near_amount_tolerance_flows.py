"""Dissolve legacy transfer flows whose legs differ in absolute amount by 0 < x <= 1

An earlier transfer detection matched pairs whose amounts didn't have to be exactly equal, leaving flows
like a -2.90 card purchase linked to a +2.00 transfer. The current detection matches exact amounts only,
so any flow whose members' absolute amounts differ by more than 0 but at most 1 EUR is such a stale
tolerance artifact.

Revision ID: 0058
Revises: 0057
Create Date: 2026-08-16 19:30:00.000000
"""

from collections import defaultdict
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0058"
down_revision: Union[str, None] = "0057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MAX_TOLERANCE_SPREAD = 1.0


def upgrade() -> None:
    _dissolve_near_amount_flows()


def downgrade() -> None:
    # Lossy: the dissolved links are gone. Detection re-forms the exact-amount ones, so this is a no-op.
    pass


def _dissolve_near_amount_flows() -> None:
    connection = op.get_bind()
    members: dict[int, list[int]] = defaultdict(list)
    amounts: dict[int, list[float]] = defaultdict(list)
    for flow_id, transaction_id, amount in connection.execute(
        sa.text("SELECT flow_id, id, amount FROM transactions WHERE flow_id IS NOT NULL")
    ):
        members[flow_id].append(transaction_id)
        amounts[flow_id].append(abs(amount))

    for flow_id, abs_amounts in amounts.items():
        spread = round(max(abs_amounts) - min(abs_amounts), 2)
        if 0 < spread <= MAX_TOLERANCE_SPREAD:
            for transaction_id in members[flow_id]:
                connection.execute(
                    sa.text(
                        "UPDATE transactions SET transaction_type = COALESCE(transfer_original_type, transaction_type), "
                        "transfer_original_type = NULL, flow_link_source = NULL, flow_id = NULL WHERE id = :id"
                    ),
                    {"id": transaction_id},
                )
            connection.execute(sa.text("DELETE FROM transfer_flows WHERE id = :flow_id"), {"flow_id": flow_id})
