from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BANKS_BY_NAME
from source.backend.bank_handlers import base as base_module

from tests.backend.conftest import create_fetched_transaction


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


def test_to_string_for_transaction_categorization_delegates_to_helper(monkeypatch: pytest.MonkeyPatch):
    fetched_transaction = create_fetched_transaction()
    formatter = MagicMock(return_value="FORMATTED")
    monkeypatch.setattr(target=base_module, name="format_transaction_for_categorization", value=formatter)

    assert fetched_transaction.to_string_for_transaction_categorization() == "FORMATTED"
    formatter.assert_called_once_with(fetched_transaction)
