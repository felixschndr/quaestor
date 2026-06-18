from source.backend.models.account_balance_snapshot import (
    AccountBalanceSnapshot,
    BalanceSnapshotSource,
)

from tests.backend.conftest import RECENT_DATE


def test_account_balance_snapshot_repr_contains_identifying_fields():
    snapshot = AccountBalanceSnapshot(
        id=3, account_id=42, date=RECENT_DATE, balance=500.0, source=BalanceSnapshotSource.BANK_REPORTED
    )

    assert repr(snapshot) == (
        "<AccountBalanceSnapshot(id=3, account_id=42, date=2026-04-29, balance=500.0, source=BANK_REPORTED)>"
    )
