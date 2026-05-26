from datetime import date

from source.backend.api.schemas.transaction import TransactionFilter


def test_transaction_filter_to_filter_parameters_excludes_unset_fields():
    filter_ = TransactionFilter(text="rewe", date_from=date(year=2026, month=1, day=1))

    parameters = filter_.to_filter_parameters()

    assert parameters == {"text": "rewe", "date_from": date(year=2026, month=1, day=1)}


def test_transaction_filter_to_filter_parameters_is_empty_when_nothing_is_set():
    assert TransactionFilter().to_filter_parameters() == {}
