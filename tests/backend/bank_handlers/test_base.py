import pytest

from tests.backend.conftest import create_fetched_transaction


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
