from datetime import date, timedelta
from statistics import median

import pytest

from source.backend.models.contracts.contract import OVERDUE_GRACE, Contract
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

    assert not contract.is_outlier(_create_transaction_from_amount(999.0))


@pytest.mark.parametrize(
    argnames="expected_next_date, offset_days, expected",
    argvalues=[
        (None, 0, False),
        (LATEST_DATE, 0, False),
        (LATEST_DATE, OVERDUE_GRACE.days, False),
        (LATEST_DATE, OVERDUE_GRACE.days + 1, True),
    ],
)
def test_is_overdue_on(expected_next_date: date | None, offset_days: int, expected: bool):
    contract = Contract(expected_next_date=expected_next_date)

    assert contract.is_overdue_on(today=LATEST_DATE + timedelta(days=offset_days)) is expected


@pytest.mark.parametrize(
    argnames="amounts, expected_outliers",
    argvalues=[
        ([-46.49, -44.99, -44.99, -44.99], [-46.49]),
        ([-30.06, -29.99, -30.74, -29.99], []),
        ([2189.44, 4224.79, 5705.53], [2189.44, 5705.53]),
        ([4000.0, 4200.0, 4400.0, 3800.0], []),
        ([2000.0, 2000.0, 3000.0, 2000.0], [3000.0]),
    ],
)
def test_get_outliers_from_amounts(amounts: list[float], expected_outliers: list[float]):
    assert sorted(_get_outliers_from_amounts(amounts)) == expected_outliers


@pytest.mark.parametrize(argnames="amount", argvalues=[4224.79, 4500.0, 3900.0])
def test_amounts_within_band_are_not_outliers(amount: float):
    contract = _create_contract_with_amounts([2189.44, 4224.79, 5705.53])

    # The median itself and values comfortably inside the cap are never outliers.
    assert contract.is_outlier(_create_transaction_from_amount(amount)) is (abs(amount - 4224.79) > 0.25 * 4224.79)
