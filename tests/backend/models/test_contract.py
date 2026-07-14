from datetime import timedelta
from statistics import median

import pytest

from source.backend.models.contracts.contract import OVERDUE_GRACE_DAYS, Contract
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import LATEST_DATE


def _create_contract_with_amounts(amounts: list[float]) -> Contract:
    center = median(amounts)
    spread = median([abs(amount - center) for amount in amounts])
    return Contract(median_amount=center, amount_spread=spread)


def _create_transaction_from_amount(amount: float) -> Transaction:
    transaction_type = TransactionType.OUTGOING if amount < 0 else TransactionType.INCOMING
    return Transaction(amount=amount, transaction_type=transaction_type)


def _get_outliers_from_amounts(amounts: list[float]) -> list[float]:
    contract = _create_contract_with_amounts(amounts)
    return [amount for amount in amounts if contract.is_outlier(_create_transaction_from_amount(amount))]


def test_no_stats_means_no_outlier():
    contract = Contract(median_amount=None, amount_spread=None)

    assert contract.is_outlier(_create_transaction_from_amount(999.0)) is False


def test_contract_without_expected_date_is_never_overdue():
    contract = Contract(expected_next_date=None)

    assert contract.is_overdue_on(today=LATEST_DATE) is False


def test_contract_within_grace_period_is_not_overdue():
    contract = Contract(expected_next_date=LATEST_DATE)

    assert contract.is_overdue_on(today=LATEST_DATE) is False
    assert contract.is_overdue_on(today=LATEST_DATE + timedelta(days=OVERDUE_GRACE_DAYS)) is False


def test_contract_past_grace_period_is_overdue():
    contract = Contract(expected_next_date=LATEST_DATE)

    assert contract.is_overdue_on(today=LATEST_DATE + timedelta(days=OVERDUE_GRACE_DAYS + 1)) is True


def test_absolute_floor_governs_stable_small_amounts():
    amounts = [-46.49, -44.99, -44.99, -44.99]

    assert _get_outliers_from_amounts(amounts) == [-46.49]


def test_sub_floor_deviation_is_treated_as_noise():
    amounts = [-30.06, -29.99, -30.74, -29.99]

    assert _get_outliers_from_amounts(amounts) == []


def test_relative_cap_catches_outliers_in_small_high_value_sample():
    amounts = [2189.44, 4224.79, 5705.53]

    assert sorted(_get_outliers_from_amounts(amounts)) == [2189.44, 5705.53]


def test_relative_cap_does_not_flag_moderate_variation():
    amounts = [4000.0, 4200.0, 4400.0, 3800.0]

    assert _get_outliers_from_amounts(amounts) == []


def test_clear_outlier_in_consistent_series_is_flagged():
    amounts = [2000.0, 2000.0, 3000.0, 2000.0]

    assert _get_outliers_from_amounts(amounts) == [3000.0]


@pytest.mark.parametrize(argnames="amount", argvalues=[4224.79, 4500.0, 3900.0])
def test_amounts_within_band_are_not_outliers(amount: float):
    contract = _create_contract_with_amounts([2189.44, 4224.79, 5705.53])

    # The median itself and values comfortably inside the cap are never outliers.
    assert contract.is_outlier(_create_transaction_from_amount(amount)) is (abs(amount - 4224.79) > 0.25 * 4224.79)
