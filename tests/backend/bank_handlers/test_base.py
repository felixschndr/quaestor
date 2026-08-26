import logging
from datetime import date

import pytest

from source.backend.bank_handlers import BANKS_BY_NAME
from source.backend.bank_handlers.base import build_daily_market_value_history
from tests.backend.conftest import assert_log_contains, create_fetched_transaction


def test_field_rules_default_to_empty_for_banks_without_rules():
    assert BANKS_BY_NAME["dfs"].information_for_user["field_rules"] == {}


@pytest.mark.parametrize(
    argnames="raw, expected",
    argvalues=[
        ("  leading-spaces", "leading-spaces"),
        ("trailing-spaces  ", "trailing-spaces"),
        ("\tleading-tab", "leading-tab"),
        ("trailing-newline\n", "trailing-newline"),
        ("  \n both-sides \t ", "both-sides"),
        ("no-whitespace", "no-whitespace"),
        ("inside no strip", "inside no strip"),
    ],
)
def test_purpose_is_stripped_on_construction(raw: str, expected: str):
    assert create_fetched_transaction(purpose=raw).purpose == expected


@pytest.mark.parametrize(
    argnames="raw, expected",
    argvalues=[
        ("  ALDI SUED  ", "ALDI SUED"),
        ("\tREWE\n", "REWE"),
    ],
)
def test_other_party_is_stripped_on_construction(raw: str, expected: str):
    assert create_fetched_transaction(other_party=raw).other_party == expected


def test_daily_market_value_history_multiplies_holding_by_daily_close():
    moves = [(date(year=2025, month=3, day=24), 10.0), (date(year=2025, month=4, day=1), 5.0)]
    prices = {
        date(year=2025, month=3, day=23): 90.0,  # before the first trade -> skipped
        date(year=2025, month=3, day=24): 100.0,
        date(year=2025, month=3, day=25): 110.0,
        date(year=2025, month=4, day=1): 120.0,
    }

    series = build_daily_market_value_history(label="World", moves=moves, prices=prices)

    assert [(observation.date, observation.amount) for observation in series] == [
        (date(year=2025, month=3, day=24), 1000.0),
        (date(year=2025, month=3, day=25), 1100.0),
        (date(year=2025, month=4, day=1), 1800.0),
    ]


def test_daily_market_value_history_logs_debug_summary(caplog: pytest.LogCaptureFixture):
    moves = [(date(year=2025, month=3, day=24), 10.0)]
    prices = {date(year=2025, month=3, day=24): 100.0}

    with caplog.at_level(logging.DEBUG):
        build_daily_market_value_history(label="World", moves=moves, prices=prices)

    assert_log_contains(caplog, message="Valued World")


def test_daily_market_value_history_without_prices_or_moves_is_empty():
    moves = [(date(year=2025, month=3, day=24), 10.0)]
    prices = {date(year=2025, month=3, day=24): 100.0}

    assert build_daily_market_value_history(label="World", moves=moves, prices={}) == []
    assert build_daily_market_value_history(label="World", moves=[], prices=prices) == []
