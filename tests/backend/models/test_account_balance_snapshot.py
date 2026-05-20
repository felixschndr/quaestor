from datetime import date

from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot


def test_account_balance_snapshot_repr_contains_identifying_fields():
    snapshot = AccountBalanceSnapshot(id=3, account_id=42, date=date(year=2026, month=5, day=20), balance=500.0)

    assert repr(snapshot) == "<AccountBalanceSnapshot(id=3, account_id=42, date=2026-05-20, balance=500.0)>"
