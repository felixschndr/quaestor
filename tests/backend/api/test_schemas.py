from datetime import date, datetime

from pydantic import BaseModel
from source.backend.api.schemas.common import UtcDatetime
from source.backend.api.schemas.transaction import TransactionFilter


class _UtcModel(BaseModel):
    at: UtcDatetime
    maybe: UtcDatetime | None = None


def test_utc_datetime_serializes_naive_value_with_explicit_utc_offset():
    dumped = _UtcModel(at=datetime(year=2026, month=6, day=14, hour=13)).model_dump(mode="json")

    assert dumped["at"] == "2026-06-14T13:00:00+00:00"


def test_utc_datetime_only_rewrites_for_json_not_python_mode():
    dumped = _UtcModel(at=datetime(year=2026, month=6, day=14, hour=13)).model_dump()

    assert dumped["at"] == datetime(year=2026, month=6, day=14, hour=13)


def test_transaction_filter_to_filter_parameters_excludes_unset_fields():
    filter_ = TransactionFilter(text="rewe", date_from=date(year=2026, month=1, day=1))

    parameters = filter_.to_filter_parameters()

    assert parameters == {"text": "rewe", "date_from": date(year=2026, month=1, day=1)}


def test_transaction_filter_to_filter_parameters_is_empty_when_nothing_is_set():
    assert TransactionFilter().to_filter_parameters() == {}
