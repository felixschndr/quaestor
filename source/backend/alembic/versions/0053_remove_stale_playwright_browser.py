"""Remove the stale Playwright/Chromium browser cache

The pre-v2 Trade Republic web login downloaded ~630 MB of Chromium into DATA_DIR/playwright to answer the AWS WAF
challenge. The v2 login needs no WAF token.

Revision ID: 0053
Revises: 0052
Create Date: 2026-08-06 15:30:00.000000
"""

import shutil
from typing import Sequence, Union

from source.backend.paths import DATA_DIR

revision: str = "0053"
down_revision: Union[str, None] = "0052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    shutil.rmtree(DATA_DIR / "playwright", ignore_errors=True)


def downgrade() -> None:
    pass
