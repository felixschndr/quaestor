import logging

import pytest

from source.backend.models.transactions.category_source import CategorySource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import (
    INCOMING_ONLY_GROUPS,
    CategorizationRules,
    CategoryGroup,
    TransactionCategory,
    expand_category_selection,
)
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import (
    AMOUNT,
    PERSON_NAME,
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    assert_log_contains,
    create_fetched_transaction,
)


@pytest.mark.parametrize(
    argnames="other_party,purpose,expected",
    argvalues=[
        ("Amazon Payments", None, TransactionCategory.ONLINE_SHOPPING),
        ("REWE SAGT DANKE", None, TransactionCategory.SUPERMARKET),
        ("dm-drogerie markt", None, TransactionCategory.DRUGSTORE),
        (None, "Bestellung bei Zalando", TransactionCategory.CLOTHING),
        ("ALDI SUED", None, TransactionCategory.SUPERMARKET),
        # Income
        ("Company", "LOHN / GEHALT 02/26", TransactionCategory.SALARY),
        (None, "TASCHENGELD", TransactionCategory.ALLOWANCE),
        ("Person", "Kindergeld", TransactionCategory.ALLOWANCE),
        ("Deutsche Post AG Renten Service", "RV.RENTE 02.2026", TransactionCategory.PENSION),
        ("Company", "Reisespesen 01234", TransactionCategory.REIMBURSEMENT),
        ("Zinsen", None, TransactionCategory.INTEREST),
        ("Elterngeldstelle Karlsruhe", None, TransactionCategory.PUBLIC_BENEFITS),
        (PERSON_NAME, "Kleinanzeigen Verkauf Gaming-PC", TransactionCategory.PRIVATE_SALES),
        # AG-Beitrag has no text matcher — relies on transaction_type=DEPOSIT (covered separately).
        # Investments (Trade Republic)
        ("Core MSCI World USD (Acc)", None, TransactionCategory.INVESTMENT),
        ("Nasdaq", None, TransactionCategory.INVESTMENT),
        # Streaming and software — purpose-side match wins over private person name and payment intermediaries
        ("Person", "Spotify", TransactionCategory.STREAMING),
        ("PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei Spotify AB", TransactionCategory.STREAMING),
        (None, "Disney Plus", TransactionCategory.STREAMING),
        ("PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei Apple Services", TransactionCategory.SOFTWARE_CLOUD),
        ("VISA APPLE.COM BILL", None, TransactionCategory.SOFTWARE_CLOUD),
        ("PayPal Europe", "Ihr Einkauf bei IONOS", TransactionCategory.SOFTWARE_CLOUD),
        (None, "Google Workspace", TransactionCategory.SOFTWARE_CLOUD),
        ("Alte Leipziger Lebensversicherung", "Lastschrift Mieten 03/2026", TransactionCategory.RENT),
        ("VATTENFALL EUROPE SALES", "Strom Abschlag", TransactionCategory.ELECTRICITY),
        ("Vodafone GmbH", "Rechnung", TransactionCategory.INTERNET_PHONE),
        ("Rundfunk ARD, ZDF, DRadio", None, TransactionCategory.BROADCASTING_FEE),
        ("VISA TUEV SUED AUTO SERVICE", None, TransactionCategory.CAR),
        (None, "TUV", TransactionCategory.CAR),
        ("Deutsche Bahn AG", "Ticket", TransactionCategory.PUBLIC_TRANSPORT),
        (None, "DB Vertrieb GmbH", TransactionCategory.PUBLIC_TRANSPORT),
        ("Marriott Hotel Berlin", None, TransactionCategory.VACATION),
        ("VISA ARAL STATION", None, TransactionCategory.FUEL),
        ("VISA BFT TANKSTELLE DER EFA", None, TransactionCategory.FUEL),
        # SAVINGS text matchers (default type=OUTGOING — exercises matcher path, not type pre-check)
        ("Einzahlung", None, TransactionCategory.SAVINGS),
        (None, "Sparen", TransactionCategory.SAVINGS),
        # Fitness
        ("Fit-in FitnessClubs GmbH", None, TransactionCategory.FITNESS),
        ("VISA AMZN MKTP DE*DN0HZ32V5", None, TransactionCategory.ONLINE_SHOPPING),
        ("VISA KLEINANZEIGEN.DE", None, TransactionCategory.ONLINE_SHOPPING),
        ("VISA APPLE STORE", None, TransactionCategory.ELECTRONICS),
        ("VISA HFB ECO IKEA 551", None, TransactionCategory.FURNISHING),
        ("VISA ERNST LEBENSMITTELGMBH", None, TransactionCategory.SUPERMARKET),
        ("VISA DOENER EXPRESS", None, TransactionCategory.RESTAURANTS),
        ("VISA PIZZERIA DA BOMBA", None, TransactionCategory.RESTAURANTS),
        ("VISA ARAMARK DFS", None, TransactionCategory.RESTAURANTS),
        ("VISA EUREST DEUTSCHLAND GMB", None, TransactionCategory.RESTAURANTS),
        ("VISA BAECKEREI", None, TransactionCategory.RESTAURANTS),
        ("VISA SUMUP  *KOFTECI OGUZ", None, TransactionCategory.RESTAURANTS),
        (None, "Lieferando.de Bestellung", TransactionCategory.FOOD_DELIVERY),
        # Lifestyle
        ("VISA NEW YORKER 20118", None, TransactionCategory.CLOTHING),
        # Repeated whitespace from the bank must not break a multi-word matcher
        ("VISA JACK  JONES KARLSRUHE", None, TransactionCategory.CLOTHING),
        ("VISA MEWAN FRISEURSTUDIO", None, TransactionCategory.PERSONAL_CARE),
        ("VISA BLUME 2000 SE", None, TransactionCategory.GIFTS),
        ("VISA PAYPAL *STEAM GAMES", None, TransactionCategory.GAMING),
        ("PayPal Europe S.a.r.l. et Cie S.C.A", "Ihr Einkauf bei Nintendo", TransactionCategory.GAMING),
        ("GoCardless Ltd", "GCNTGPQ", TransactionCategory.FEES),
        ("Stadt Karlsruhe", "503016420621/Bewohnerparkausweis", TransactionCategory.PARKING),
        ("VISA DEUTSCHE POST AG", None, TransactionCategory.FEES),
        ("HUK-COBURG", "Beitrag Haftpflichtversicherung", TransactionCategory.OTHER_INSURANCE),
        ("R+V Allgemeine Versicherung Aktiengesellschaft", "Police", TransactionCategory.OTHER_INSURANCE),
        ("AOK", "Krankenversicherung", TransactionCategory.HEALTH_INSURANCE),
        ("Kanzlei Meier", "Rechtsanwalt Honorar", TransactionCategory.LEGAL),
        ("Notariat Dr. Schmidt", "Beurkundung", TransactionCategory.LEGAL),
        ("Finanzamt Karlsruhe", "Einkommensteuer 2025", TransactionCategory.TAXES),
        ("UNICEF", "Spende", TransactionCategory.DONATION),
        (None, "Kreditkartenabrechnung 09/2026", TransactionCategory.CREDIT_CARD_SETTLEMENT),
        ("Kita Sonnenschein", "Betreuungsbeitrag", TransactionCategory.CHILDCARE),
        ("Fressnapf", None, TransactionCategory.PET_SUPPLIES),
        ("Tierarztpraxis Dr. Huf", None, TransactionCategory.VET),
        # Private person names alone stay UNKNOWN — no matcher rule
        ("John Doe", None, TransactionCategory.UNKNOWN),
        (PERSON_NAME, None, TransactionCategory.UNKNOWN),
        ("Richard Roe", None, TransactionCategory.UNKNOWN),
        # Truly unknown fallbacks
        (UNKNOWN_TRANSACTION_OTHER_PARTY, "Miscellaneous", TransactionCategory.UNKNOWN),
        (None, None, TransactionCategory.UNKNOWN),
    ],
)
def test_from_transaction_matches_other_party_and_purpose(
    other_party: str | None, purpose: str | None, expected: TransactionCategory
):
    amount = AMOUNT if expected.group in INCOMING_ONLY_GROUPS else -AMOUNT
    fetched = create_fetched_transaction(amount=amount, other_party=other_party, purpose=purpose)

    assert TransactionCategory.from_transaction(transaction=fetched) == expected


@pytest.mark.parametrize(
    argnames="other_party, purpose, incoming, outgoing",
    argvalues=[
        ("Finanzamt Karlsruhe", "Steuererstattung 2025", TransactionCategory.REIMBURSEMENT, TransactionCategory.TAXES),
        (PERSON_NAME, "Kleinanzeigen", TransactionCategory.PRIVATE_SALES, TransactionCategory.ONLINE_SHOPPING),
        (PERSON_NAME, "Taschengeld", TransactionCategory.ALLOWANCE, TransactionCategory.POCKET_MONEY),
        ("Sparkasse", "Zinsen", TransactionCategory.INTEREST, TransactionCategory.BANK_FEES),
        ("Deutsche Rentenversicherung", None, TransactionCategory.PENSION, TransactionCategory.OTHER_INSURANCE),
        (PERSON_NAME, "Miete Wohnung 3", TransactionCategory.RENTAL_INCOME, TransactionCategory.RENT),
    ],
)
def test_the_direction_of_the_money_decides_between_income_and_expense(
    other_party: str | None, purpose: str | None, incoming: TransactionCategory, outgoing: TransactionCategory
):
    def categorize(amount: float) -> TransactionCategory:
        fetched = create_fetched_transaction(amount=amount, other_party=other_party, purpose=purpose)
        return TransactionCategory.from_transaction(transaction=fetched)

    assert categorize(AMOUNT) == incoming
    assert categorize(-AMOUNT) == outgoing


def test_every_category_but_unknown_belongs_to_a_group():
    assert TransactionCategory.SALARY.group == CategoryGroup.INCOME
    assert TransactionCategory.UNKNOWN.group is None
    assert {category for category in TransactionCategory if category.group is None} == {TransactionCategory.UNKNOWN}


def test_expanding_a_selection_replaces_groups_by_their_categories():
    selection = [CategoryGroup.PETS, TransactionCategory.SALARY, "INSURANCE", "VET"]

    assert expand_category_selection(selection) == [
        TransactionCategory.PET_SUPPLIES,
        TransactionCategory.VET,
        TransactionCategory.SALARY,
        TransactionCategory.HEALTH_INSURANCE,
        TransactionCategory.OTHER_INSURANCE,
    ]


def test_bank_flagged_refund_is_reimbursement_without_a_keyword():
    fetched = create_fetched_transaction(
        amount=AMOUNT, other_party=PERSON_NAME, transaction_type=TransactionType.INCOMING, is_refund=True
    )

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.REIMBURSEMENT


def test_from_fetched_marks_a_bank_flagged_refund_as_system_categorised():
    fetched = create_fetched_transaction(
        amount=AMOUNT, other_party=PERSON_NAME, transaction_type=TransactionType.INCOMING, is_refund=True
    )

    assert Transaction.from_fetched(fetched_transaction=fetched).category_source == CategorySource.SYSTEM


def test_from_fetched_assigns_matching_category():
    fetched = create_fetched_transaction(other_party="Amazon EU", purpose="Order")

    transaction = Transaction.from_fetched(fetched_transaction=fetched)

    assert transaction.category == TransactionCategory.ONLINE_SHOPPING
    assert transaction.category_source == CategorySource.AUTO


def test_from_fetched_logs_unknown_with_other_party_and_purpose(caplog: pytest.LogCaptureFixture):
    fetched = create_fetched_transaction(other_party=UNKNOWN_TRANSACTION_OTHER_PARTY, purpose="Miscellaneous")

    Transaction.from_fetched(fetched_transaction=fetched)

    assert_log_contains(caplog, messages=["No category matched", UNKNOWN_TRANSACTION_OTHER_PARTY, "Miscellaneous"])


def test_from_fetched_debug_logs_matched_category(caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.DEBUG)
    fetched = create_fetched_transaction(other_party="REWE Markt")

    Transaction.from_fetched(fetched_transaction=fetched)

    assert_log_contains(caplog, message="No category matched", negate=True)
    assert_log_contains(caplog, messages=["Matched", "REWE Markt", TransactionCategory.SUPERMARKET.value])


def test_log_result_false_keeps_the_log_quiet(caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.DEBUG)
    fetched = create_fetched_transaction(other_party=UNKNOWN_TRANSACTION_OTHER_PARTY, purpose="Miscellaneous")

    TransactionCategory.from_transaction(transaction=fetched, log_result=False)

    assert_log_contains(caplog, message="No category matched", negate=True)


@pytest.mark.parametrize(
    argnames="transaction_type, expected",
    argvalues=[
        (TransactionType.DEPOSIT, TransactionCategory.SAVINGS),
        (TransactionType.REMOVAL, TransactionCategory.WITHDRAWAL),
    ],
)
def test_type_short_circuits_to_category_regardless_of_text(
    transaction_type: TransactionType, expected: TransactionCategory
):
    fetched = create_fetched_transaction(other_party=PERSON_NAME, purpose=None, transaction_type=transaction_type)

    assert TransactionCategory.from_transaction(transaction=fetched) == expected


def test_ag_beitrag_with_deposit_type_yields_savings():
    # AG-Beitrag laufend is the employer's recurring contribution (VL) — recorded as a DEPOSIT
    # onto the savings account. It must end up in SAVINGS via the type pre-check, not PENSION.
    fetched = create_fetched_transaction(
        other_party=None, purpose="AG-Beitrag laufend", transaction_type=TransactionType.DEPOSIT
    )

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.SAVINGS


@pytest.mark.parametrize(
    argnames="transaction_type",
    argvalues=[
        TransactionType.BUY,
        TransactionType.SELL,
        TransactionType.DIVIDEND,
        TransactionType.SPINOFF,
        TransactionType.SPLIT,
        TransactionType.SWAP,
        TransactionType.TAX_REFUND,
    ],
)
def test_brokerage_types_yield_investment_regardless_of_text(transaction_type: TransactionType):
    fetched = create_fetched_transaction(other_party="Tesla", purpose=None, transaction_type=transaction_type)

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.INVESTMENT


@pytest.mark.parametrize(argnames="transaction_type", argvalues=[TransactionType.OUTGOING, None])
def test_non_type_based_transaction_falls_through_to_text_matchers(transaction_type: TransactionType | None):
    # Only DEPOSIT/REMOVAL are type-based; other types still go through the text matchers.
    fetched = create_fetched_transaction(other_party="REWE Markt", purpose=None, transaction_type=transaction_type)

    assert TransactionCategory.from_transaction(transaction=fetched) == TransactionCategory.SUPERMARKET


def test_a_user_rule_beats_the_default_matchers_and_the_transaction_type():
    rules = CategorizationRules(user_rules=(("rewe", TransactionCategory.GIFTS),))
    groceries = create_fetched_transaction(other_party="REWE Markt")
    deposit = create_fetched_transaction(other_party="REWE Markt", transaction_type=TransactionType.DEPOSIT)

    assert TransactionCategory.from_transaction(transaction=groceries, rules=rules) == TransactionCategory.GIFTS
    assert TransactionCategory.from_transaction(transaction=deposit, rules=rules) == TransactionCategory.GIFTS


def test_the_first_matching_user_rule_wins():
    rules = CategorizationRules(
        user_rules=(("rewe markt", TransactionCategory.GIFTS), ("rewe", TransactionCategory.RESTAURANTS))
    )
    fetched = create_fetched_transaction(other_party="REWE Markt")

    assert TransactionCategory.from_transaction(transaction=fetched, rules=rules) == TransactionCategory.GIFTS


def test_a_bank_flagged_refund_beats_a_user_rule():
    rules = CategorizationRules(user_rules=(("rewe", TransactionCategory.GIFTS),))
    refund = create_fetched_transaction(amount=AMOUNT, other_party="REWE Markt", is_refund=True)

    assert TransactionCategory.from_transaction(transaction=refund, rules=rules) == TransactionCategory.REIMBURSEMENT


def test_a_user_rule_for_an_income_category_ignores_outgoing_money():
    rules = CategorizationRules(user_rules=(("computer", TransactionCategory.PRIVATE_SALES),))

    def categorize(amount: float) -> TransactionCategory:
        fetched = create_fetched_transaction(amount=amount, other_party=PERSON_NAME, purpose="Computer")
        return TransactionCategory.from_transaction(transaction=fetched, rules=rules)

    assert categorize(AMOUNT) == TransactionCategory.PRIVATE_SALES
    assert categorize(-AMOUNT) == TransactionCategory.UNKNOWN


def test_a_disabled_default_matcher_is_skipped_but_later_ones_still_match():
    rules = CategorizationRules(disabled_default_matchers=frozenset({"spotify"}))
    via_paypal = create_fetched_transaction(other_party="PayPal Europe", purpose="Ihr Einkauf bei Spotify")
    direct = create_fetched_transaction(other_party="Spotify AB")

    assert (
        TransactionCategory.from_transaction(transaction=via_paypal, rules=rules) == TransactionCategory.ONLINE_SHOPPING
    )
    assert TransactionCategory.from_transaction(transaction=direct, rules=rules) == TransactionCategory.UNKNOWN
