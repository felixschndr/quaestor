from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import RECENT_DATE


def test_transaction_repr_contains_identifying_fields():
    transaction = Transaction(
        id=99,
        account_id=42,
        amount=-19.99,
        purpose="Coffee",
        date=RECENT_DATE,
        other_party="Café",
        transaction_type=TransactionType.OUTGOING,
        category=TransactionCategory.UNKNOWN,
        note="Birthday gift",
    )

    assert repr(transaction) == (
        "<Transaction(id=99, account_id=42, amount=-19.99, purpose=Coffee, "
        "date=2026-04-29, other_party=Café, transaction_type=OUTGOING, "
        "category=UNKNOWN, note=Birthday gift, pending=None, bank_reference=None, expected=None, "
        "match_tolerance_percent=None, transfer_counterpart_id=None, "
        "transfer_original_type=None, transfer_relink_blocked=None, recurring_transaction_id=None, "
        "contract_id=None, contract_assignment=None)>"
    )
