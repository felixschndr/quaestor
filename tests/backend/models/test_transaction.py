from datetime import date

from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType


def test_transaction_repr_contains_identifying_fields():
    transaction = Transaction(
        id=99,
        account_id=42,
        amount=-19.99,
        purpose="Coffee",
        date=date(year=2026, month=5, day=20),
        other_party="Café",
        transaction_type=TransactionType.OUTGOING,
        category=TransactionCategory.UNKNOWN,
        note="Birthday gift",
    )

    assert repr(transaction) == (
        "<Transaction(id=99, account_id=42, amount=-19.99, purpose=Coffee, "
        "date=2026-05-20, other_party=Café, transaction_type=OUTGOING, "
        "category=UNKNOWN, note=Birthday gift, transfer_counterpart_id=None, "
        "transfer_original_type=None, transfer_relink_blocked=None)>"
    )
