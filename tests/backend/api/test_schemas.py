from datetime import date, datetime

import pytest
from pydantic import BaseModel

from source.backend.api.schemas.contracts.contract import ContractRead
from source.backend.api.schemas.core.common import UtcDatetime
from source.backend.api.schemas.transactions.transaction import TransactionSearchQuery
from source.backend.models.contracts.contract_frequency import ContractFrequency
from tests.backend.conftest import AMOUNT, build_contract


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
    filter_ = TransactionSearchQuery(account_ids=[1], text="rewe", date_from=date(year=2026, month=1, day=1))

    parameters = filter_.to_filter_parameters()

    assert parameters == {"text": "rewe", "date_from": date(year=2026, month=1, day=1)}


def test_transaction_filter_to_filter_parameters_is_empty_when_nothing_is_set():
    assert TransactionSearchQuery(account_ids=[1]).to_filter_parameters() == {}


def test_contract_read_shows_exact_median_for_the_detected_frequency():
    # A monthly contract observed at 31-day gaps must not round-trip through
    # median / 31 * 30 — the MONTHLY row is anchored to the median itself.
    contract = build_contract(frequency=ContractFrequency.MONTHLY, interval_days=31)

    read = ContractRead.from_contract(contract)

    assert read.amount_per_frequency[ContractFrequency.MONTHLY] == AMOUNT
    assert read.amount_per_day == pytest.approx(AMOUNT / 30)
    assert read.amount_per_frequency[ContractFrequency.YEARLY] == pytest.approx(AMOUNT / 30 * 365)


def test_contract_read_falls_back_to_observed_interval_without_frequency():
    contract = build_contract(frequency=None, interval_days=10)

    read = ContractRead.from_contract(contract)

    assert read.amount_per_day == pytest.approx(AMOUNT / 10)
