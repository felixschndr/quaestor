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

from alembic import op
from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.models.accounts.account import Account

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    for account in session.scalars(select(Account)):
        account.recompute_balances_at_date()
    session.flush()


def downgrade() -> None:
    pass
