"""Backfill balance snapshots with the corrected (drift-free) computation

`update_balance_at_date` used to reset the backward walk to bank-reported anchors even inside the transaction
range. A booking present in today's balance but missing from a stale anchor (e.g. a back-dated transfer the
bank's daily balance never saw) then leaked across the bank->computed seam and surfaced as a phantom day-over-day
jump in the net-worth series. The fix makes the transaction walk authoritative within the fetched range and treats
in-range anchors as validation-only.

Revision ID: 0027
Revises: 0026
Create Date: 2026-06-14 17:30:00.000000
"""

from typing import Sequence, Union

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No-op (kept so already-migrated databases stay consistent).
    # The original backfill loaded accounts through the live ORM models, whose SELECT references columns added by later
    # migrations --> Crashes on any database below this revision with "no such column".
    # The backfill is redundant anyway: every sync recomputes the balance history per account.
    pass


def downgrade() -> None:
    pass
