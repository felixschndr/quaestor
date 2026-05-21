from datetime import date

import pytest
from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.models.transaction_type import TransactionType


def _make_fetched(*, purpose: str | None, other_party: str | None) -> FetchedTransaction:
    return FetchedTransaction(
        amount=-1.0,
        purpose=purpose,
        date=date(year=2026, month=5, day=21),
        other_party=other_party,
        transaction_type=TransactionType.OUTGOING,
    )


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
    assert _make_fetched(purpose=raw, other_party=None).purpose == expected


@pytest.mark.parametrize(
    argnames="raw, expected",
    argvalues=[
        ("  ALDI SUED  ", "ALDI SUED"),
        ("\tREWE\n", "REWE"),
    ],
)
def test_other_party_is_stripped_on_construction(raw: str, expected: str):
    assert _make_fetched(purpose=None, other_party=raw).other_party == expected
