from datetime import date

import pytest
from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType


def _make_fetched(*, other_party: str | None = None, purpose: str | None = None) -> FetchedTransaction:
    return FetchedTransaction(
        amount=-12.34,
        purpose=purpose,
        date=date(year=2026, month=5, day=21),
        other_party=other_party,
        transaction_type=TransactionType.OUTGOING,
    )


@pytest.mark.parametrize(
    argnames="other_party,purpose,expected",
    argvalues=[
        ("Amazon Payments", None, TransactionCategory.ONLINE_SHOPPING),
        ("REWE SAGT DANKE", None, TransactionCategory.SUPERMARKET),
        ("dm-drogerie markt", None, TransactionCategory.DRUGSTORE),
        (None, "Bestellung bei Zalando", TransactionCategory.ONLINE_SHOPPING),
        ("ALDI SUED", None, TransactionCategory.SUPERMARKET),
        ("Random Bakery", "Bread", TransactionCategory.UNKNOWN),
        (None, None, TransactionCategory.UNKNOWN),
    ],
)
def test_from_transaction_matches_other_party_and_purpose(
    other_party: str | None, purpose: str | None, expected: TransactionCategory
):
    fetched = _make_fetched(other_party=other_party, purpose=purpose)

    assert TransactionCategory.from_transaction(transaction=fetched) == expected


def test_from_fetched_assigns_matching_category():
    fetched = _make_fetched(other_party="Amazon EU", purpose="Order")

    transaction = Transaction.from_fetched(fetched_transaction=fetched)

    assert transaction.category == TransactionCategory.ONLINE_SHOPPING


def test_from_fetched_falls_back_to_unknown_when_no_match():
    fetched = _make_fetched(other_party="Some Tiny Cafe", purpose="Coffee")

    transaction = Transaction.from_fetched(fetched_transaction=fetched)

    assert transaction.category == TransactionCategory.UNKNOWN


def test_from_fetched_logs_unknown_with_other_party_and_purpose(caplog: pytest.LogCaptureFixture):
    fetched = _make_fetched(other_party="Some Tiny Cafe", purpose="Black coffee")

    with caplog.at_level("INFO", logger="source.backend.models.transaction"):
        Transaction.from_fetched(fetched_transaction=fetched)

    assert any(
        "No category matched" in record.message
        and "Some Tiny Cafe" in record.message
        and "Black coffee" in record.message
        for record in caplog.records
    )


def test_from_fetched_does_not_log_unknown_for_matched_transaction(caplog: pytest.LogCaptureFixture):
    fetched = _make_fetched(other_party="REWE Markt")

    with caplog.at_level("INFO", logger="source.backend.models.transaction"):
        Transaction.from_fetched(fetched_transaction=fetched)

    assert not any("No category matched" in record.message for record in caplog.records)
