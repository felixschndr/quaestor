import pytest
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType

from tests.backend.conftest import (
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    create_fetched_transaction,
)


@pytest.mark.parametrize(
    argnames="other_party,purpose,expected",
    argvalues=[
        ("Amazon Payments", None, TransactionCategory.ONLINE_SHOPPING),
        ("REWE SAGT DANKE", None, TransactionCategory.SUPERMARKET),
        ("dm-drogerie markt", None, TransactionCategory.DRUGSTORE),
        (None, "Bestellung bei Zalando", TransactionCategory.ONLINE_SHOPPING),
        ("ALDI SUED", None, TransactionCategory.SUPERMARKET),
        # Income
        ("Company", "LOHN / GEHALT 02/26", TransactionCategory.SALARY),
        (None, "TASCHENGELD", TransactionCategory.ALLOWANCE),
        ("Person", "Kindergeld", TransactionCategory.ALLOWANCE),
        ("Deutsche Post AG Renten Service", "RV.RENTE 02.2026", TransactionCategory.PENSION),
        ("Company", "Reisespesen 01234", TransactionCategory.REIMBURSEMENT),
        ("Zinsen", None, TransactionCategory.INTEREST),
        # AG-Beitrag has no text matcher — relies on transaction_type=DEPOSIT (covered separately).
        # Investments (Trade Republic)
        ("Core MSCI World USD (Acc)", None, TransactionCategory.INVESTMENT),
        ("Nasdaq", None, TransactionCategory.INVESTMENT),
        # Subscriptions — purpose-side match wins over private person name
        ("Person", "Spotify", TransactionCategory.SUBSCRIPTIONS),
        ("PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei Spotify AB", TransactionCategory.SUBSCRIPTIONS),
        ("PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei Apple Services", TransactionCategory.SUBSCRIPTIONS),
        ("VISA APPLE.COM BILL", None, TransactionCategory.SUBSCRIPTIONS),
        ("PayPal Europe", "Ihr Einkauf bei IONOS", TransactionCategory.SUBSCRIPTIONS),
        ("VISA PAYPAL *NABU CASA", None, TransactionCategory.SUBSCRIPTIONS),
        (None, "Google Workspace", TransactionCategory.SUBSCRIPTIONS),
        # Rent / Utilities
        ("Alte Leipziger Lebensversicherung", "Lastschrift Mieten 03/2026", TransactionCategory.RENT),
        ("VATTENFALL EUROPE SALES", "Strom Abschlag", TransactionCategory.UTILITIES),
        ("Vodafone GmbH", "Rechnung", TransactionCategory.UTILITIES),
        ("Rundfunk ARD, ZDF, DRadio", None, TransactionCategory.UTILITIES),
        # Car / Fuel
        ("VW Leasing GmbH", "RATE", TransactionCategory.CAR),
        ("VISA TUEV SUED AUTO SERVICE", None, TransactionCategory.CAR),
        (None, "TUV", TransactionCategory.CAR),
        ("VISA ARAL STATION", None, TransactionCategory.FUEL),
        ("VISA BFT TANKSTELLE DER EFA", None, TransactionCategory.FUEL),
        # SAVINGS text matchers (default type=OUTGOING — exercises matcher path, not type pre-check)
        ("Einzahlung", None, TransactionCategory.SAVINGS),
        (None, "Sparen", TransactionCategory.SAVINGS),
        # Fitness
        ("Fit-in FitnessClubs GmbH", None, TransactionCategory.FITNESS),
        # Online shopping (extended)
        ("VISA AMZN MKTP DE*DN0HZ32V5", None, TransactionCategory.ONLINE_SHOPPING),
        ("VISA KLEINANZEIGEN.DE", None, TransactionCategory.ONLINE_SHOPPING),
        ("VISA APPLE STORE", None, TransactionCategory.ONLINE_SHOPPING),
        ("VISA HFB ECO IKEA 551", None, TransactionCategory.ONLINE_SHOPPING),
        # Supermarket extension
        ("VISA SCHECK-IN CENTER", None, TransactionCategory.SUPERMARKET),
        ("VISA ERNST LEBENSMITTELGMBH", None, TransactionCategory.SUPERMARKET),
        # Restaurants
        ("VISA DOENER EXPRESS", None, TransactionCategory.RESTAURANTS),
        ("VISA PIZZERIA DA BOMBA", None, TransactionCategory.RESTAURANTS),
        ("VISA ARAMARK DFS", None, TransactionCategory.RESTAURANTS),
        ("VISA EUREST DEUTSCHLAND GMB", None, TransactionCategory.RESTAURANTS),
        ("VISA BAECKEREI", None, TransactionCategory.RESTAURANTS),
        ("VISA SUMUP  *KOFTECI OGUZ", None, TransactionCategory.RESTAURANTS),
        # Lifestyle
        ("VISA NEW YORKER 20118", None, TransactionCategory.CLOTHING),
        ("VISA MEWAN FRISEURSTUDIO", None, TransactionCategory.PERSONAL_CARE),
        ("VISA BLUME 2000 SE", None, TransactionCategory.GIFTS),
        # Entertainment
        ("VISA PAYPAL *STEAM GAMES", None, TransactionCategory.ENTERTAINMENT),
        ("PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei Nintendo", TransactionCategory.ENTERTAINMENT),
        ("VISA KARLSRUHER BAEDERGESEL", None, TransactionCategory.ENTERTAINMENT),
        ("VISA STUDENTENZENTRUM Z10", None, TransactionCategory.RESTAURANTS),
        # Fees
        ("GoCardless Ltd", "GCNTGPQ", TransactionCategory.FEES),
        ("Stadt Karlsruhe", "503016420621/Bewohnerparkausweis", TransactionCategory.FEES),
        ("VISA DEUTSCHE POST AG", None, TransactionCategory.FEES),
        # Private person names alone stay UNKNOWN — no matcher rule
        ("Max Mustermann", None, TransactionCategory.UNKNOWN),
        ("Alica Parker", None, TransactionCategory.UNKNOWN),
        ("Bob Traumer", None, TransactionCategory.UNKNOWN),
        # Truly unknown fallbacks
        (UNKNOWN_TRANSACTION_OTHER_PARTY, "Miscellaneous", TransactionCategory.UNKNOWN),
        (None, None, TransactionCategory.UNKNOWN),
    ],
)
def test_from_transaction_matches_other_party_and_purpose(
    other_party: str | None, purpose: str | None, expected: TransactionCategory
):
    fetched = create_fetched_transaction(other_party=other_party, purpose=purpose)

    assert TransactionCategory.from_transaction(transaction=fetched) == expected


def test_from_fetched_assigns_matching_category():
    fetched = create_fetched_transaction(other_party="Amazon EU", purpose="Order")

    transaction = Transaction.from_fetched(fetched_transaction=fetched)

    assert transaction.category == TransactionCategory.ONLINE_SHOPPING


def test_from_fetched_logs_unknown_with_other_party_and_purpose(caplog: pytest.LogCaptureFixture):
    fetched = create_fetched_transaction(other_party=UNKNOWN_TRANSACTION_OTHER_PARTY, purpose="Miscellaneous")

    with caplog.at_level("INFO", logger="source.backend.models.transaction"):
        Transaction.from_fetched(fetched_transaction=fetched)

    assert any(
        "No category matched" in record.message
        and UNKNOWN_TRANSACTION_OTHER_PARTY in record.message
        and "Miscellaneous" in record.message
        for record in caplog.records
    )


def test_from_fetched_does_not_log_unknown_for_matched_transaction(caplog: pytest.LogCaptureFixture):
    fetched = create_fetched_transaction(other_party="REWE Markt")

    with caplog.at_level("INFO", logger="source.backend.models.transaction"):
        Transaction.from_fetched(fetched_transaction=fetched)

    assert not any("No category matched" in record.message for record in caplog.records)


def test_deposit_type_yields_savings_regardless_of_text():
    fetched = create_fetched_transaction(
        other_party="Felix Schneider", purpose=None, transaction_type=TransactionType.DEPOSIT
    )

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.SAVINGS


def test_removal_type_yields_withdrawal_regardless_of_text():
    fetched = create_fetched_transaction(
        other_party="Felix Schneider", purpose=None, transaction_type=TransactionType.REMOVAL
    )

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.WITHDRAWAL


def test_ag_beitrag_with_deposit_type_yields_savings():
    # AG-Beitrag laufend is the employer's recurring contribution (VL) — recorded as a DEPOSIT
    # onto the savings account. It must end up in SAVINGS via the type pre-check, not PENSION.
    fetched = create_fetched_transaction(
        other_party=None, purpose="AG-Beitrag laufend", transaction_type=TransactionType.DEPOSIT
    )

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.SAVINGS


def test_outgoing_type_does_not_short_circuit():
    # Only DEPOSIT/REMOVAL are type-based; OUTGOING still goes through the text matchers.
    fetched = create_fetched_transaction(
        other_party="REWE Markt", purpose=None, transaction_type=TransactionType.OUTGOING
    )

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.SUPERMARKET


def test_unknown_type_does_not_short_circuit():
    fetched = create_fetched_transaction(other_party="REWE Markt", purpose=None, transaction_type=None)

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.SUPERMARKET
