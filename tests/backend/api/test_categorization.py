from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.models.transactions.category_source import CategorySource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TRANSACTION_CATEGORY_MAPPING, TransactionCategory
from tests.backend.conftest import (
    INTRUDER_USER_NAME,
    REWE,
    persist_transaction,
    register_and_login,
    setup_account,
)

URL = "/api/categorization"


def _category_of(session_factory: sessionmaker, transaction_id: int) -> TransactionCategory:
    with session_factory() as session:
        return session.get(entity=Transaction, ident=transaction_id).category


def _create_rule(http_client: TestClient, pattern: str = "Rewe Markt", category: str = "GIFTS") -> dict:
    response = http_client.post(f"{URL}/rules", json={"pattern": pattern, "category": category})
    assert response.status_code == 201, response.text
    return response.json()


def test_get_lists_no_rules_and_every_default_matcher(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)

    body = http_client.get(URL).json()

    assert body["rules"] == []
    assert len(body["default_matchers"]) == sum(len(matchers) for matchers in TRANSACTION_CATEGORY_MAPPING.values())
    assert {"pattern": "rewe", "category": "SUPERMARKET", "disabled": False} in body["default_matchers"]


def test_creating_a_rule_normalizes_it_and_recategorizes_only_automatic_transactions(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    automatic = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        other_party="REWE Markt GmbH",
        category=TransactionCategory.SUPERMARKET,
    )
    manual = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        other_party="REWE Markt GmbH",
        category=TransactionCategory.RESTAURANTS,
        category_source=CategorySource.MANUAL,
    )

    body = _create_rule(http_client=http_client, pattern="  REWE   Märkt ")

    assert [(rule["pattern"], rule["category"]) for rule in body["rules"]] == [("rewe maerkt", "GIFTS")]
    assert body["recategorized"] == 0
    body = http_client.put(
        f"{URL}/rules/{body['rules'][0]['id']}", json={"pattern": "rewe markt", "category": "GIFTS"}
    ).json()
    assert body["recategorized"] == 1
    assert _category_of(session_factory=session_factory, transaction_id=automatic) == TransactionCategory.GIFTS
    assert _category_of(session_factory=session_factory, transaction_id=manual) == TransactionCategory.RESTAURANTS


def test_deleting_a_rule_hands_its_transactions_back_to_the_default_matchers(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id, other_party=REWE)
    rule = _create_rule(http_client=http_client, pattern=REWE)["rules"][0]
    assert _category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.GIFTS

    body = http_client.delete(f"{URL}/rules/{rule['id']}").json()

    assert body["rules"] == []
    assert (
        _category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.SUPERMARKET
    )


def test_newer_rules_are_listed_first(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)
    _create_rule(http_client=http_client, pattern="first")

    body = _create_rule(http_client=http_client, pattern="second")

    assert [rule["pattern"] for rule in body["rules"]] == ["second", "first"]


def test_a_duplicate_pattern_is_a_conflict(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)
    _create_rule(http_client=http_client, pattern=REWE)

    response = http_client.post(f"{URL}/rules", json={"pattern": REWE.upper(), "category": "FUEL"})

    assert response.status_code == 409


def test_a_rule_needs_a_real_pattern_and_category(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)

    assert http_client.post(f"{URL}/rules", json={"pattern": " x ", "category": "FUEL"}).status_code == 422
    assert http_client.post(f"{URL}/rules", json={"pattern": REWE, "category": "UNKNOWN"}).status_code == 422
    assert http_client.post(f"{URL}/rules", json={"pattern": REWE, "category": "INCOME"}).status_code == 422


def test_rules_of_another_user_are_not_accessible(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)
    rule = _create_rule(http_client=http_client)["rules"][0]

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

    assert http_client.get(URL).json()["rules"] == []
    assert http_client.delete(f"{URL}/rules/{rule['id']}").status_code == 404
    assert http_client.put(f"{URL}/rules/{rule['id']}", json={"pattern": REWE, "category": "FUEL"}).status_code == 404


def test_disabling_a_default_matcher_recategorizes_and_can_be_undone(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        other_party=REWE,
        category=TransactionCategory.SUPERMARKET,
    )

    body = http_client.put(f"{URL}/default-matchers", json={"pattern": "rewe", "disabled": True}).json()

    assert body["recategorized"] == 1
    assert {"pattern": "rewe", "category": "SUPERMARKET", "disabled": True} in body["default_matchers"]
    assert _category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.UNKNOWN

    http_client.put(f"{URL}/default-matchers", json={"pattern": "rewe", "disabled": False})

    assert (
        _category_of(session_factory=session_factory, transaction_id=transaction_id) == TransactionCategory.SUPERMARKET
    )


def test_only_default_matchers_can_be_disabled(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.put(f"{URL}/default-matchers", json={"pattern": "not a matcher", "disabled": True})

    assert response.status_code == 422


def test_categorization_requires_authentication(http_client: TestClient):
    assert http_client.get(URL).status_code == 401
