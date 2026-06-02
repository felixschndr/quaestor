"""Migrate curated ING/DKB/Sparkasse credentials to the generic FinTS provider

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-02 00:00:00.000000

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PINNED_BLZ = {"ING": "50010517", "DKB": "12030000"}
_CURATED = ("ING", "DKB", "SPARKASSE")


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, bank, credentials FROM credentials WHERE bank IN ('ING', 'DKB', 'SPARKASSE')")
    ).fetchall()
    for credential_id, bank, raw_credentials in rows:
        credentials = json.loads(raw_credentials) if isinstance(raw_credentials, str) else dict(raw_credentials or {})
        if bank in _PINNED_BLZ:
            credentials.setdefault("blz", _PINNED_BLZ[bank])
        conn.execute(
            sa.text("UPDATE credentials SET bank = 'FINTS', credentials = :credentials WHERE id = :id"),
            {"credentials": json.dumps(credentials), "id": credential_id},
        )


def downgrade() -> None:
    # Not reversible: once migrated to "fints" we can no longer tell ING/DKB/Sparkasse apart
    pass
