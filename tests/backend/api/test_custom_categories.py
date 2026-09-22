from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.models.transactions.category_source import CategorySource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    INTRUDER_USER_NAME,
    RECENT_DATE,
    SECOND_DISPLAY_NAME,
    SECOND_USER_NAME,
    VALID_PASSWORD,
    login_as,
    make_transaction,
    persist_transaction,
    register,
    register_and_login,
    setup_account,
    setup_manual_account,
)

URL = "/api/categorization/custom-categories"
BIO_SHOP = "Bio-Laden"


def _create(http_client: TestClient, name: str = BIO_SHOP, group: str = "FOOD_AND_DRINK") -> str:
    response = http_client.post(URL, json={"group": group, "name": name})
    assert response.status_code == 201, response.text
    return next(custom["key"] for custom in response.json()["custom_categories"] if custom["name"] == name.strip())


def _category_of(session_factory: sessionmaker, transaction_id: int) -> str:
    with session_factory() as session:
        return session.get(entity=Transaction, ident=transaction_id).category


def test_a_custom_category_is_listed_with_its_group(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)

    key = _create(http_client=http_client, name="  Bio-Laden  ")

    assert key.startswith("CUSTOM_")
    assert http_client.get(URL).json()["custom_categories"] == [
        {"key": key, "group": "FOOD_AND_DRINK", "name": BIO_SHOP, "owned": True}
    ]


def test_a_custom_category_name_is_unique_within_its_group(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)
    _create(http_client=http_client)

    assert http_client.post(URL, json={"group": "FOOD_AND_DRINK", "name": BIO_SHOP.upper()}).status_code == 409
    assert http_client.post(URL, json={"group": "SHOPPING", "name": BIO_SHOP}).status_code == 201
    assert http_client.post(URL, json={"group": "SHOPPING", "name": "   "}).status_code == 422
    assert http_client.post(URL, json={"group": "NOT_A_GROUP", "name": "x"}).status_code == 422


def test_a_transaction_can_get_a_custom_category_of_its_owner_only(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)
    key = _create(http_client=http_client)

    response = http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"category": key})

    assert response.status_code == 200
    assert response.json()["category"] == key
    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"category": "CUSTOM_DEADBEEF"}
    )
    assert response.status_code == 422


def test_a_group_filter_includes_its_custom_categories(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    key = _create(http_client=http_client)
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=key)
        make_transaction(session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.FUEL)
        session.commit()

    search = http_client.get(
        "/api/transactions/search", params=[("account_ids", account_id), ("categories", "FOOD_AND_DRINK")]
    )
    statistics = http_client.get(
        "/api/statistics/categories", params=[("account_ids", account_id), ("categories", "FOOD_AND_DRINK")]
    )

    assert [row["category"] for row in search.json()] == [key]
    assert statistics.json() == [{"category": key, "total": DEFAULT_AMOUNT}]


def test_a_rule_can_assign_a_custom_category(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id, other_party="Alnatura")
    key = _create(http_client=http_client)

    response = http_client.post("/api/categorization/rules", json={"pattern": "alnatura", "category": key})

    assert response.json()["recategorized"] == 1
    assert _category_of(session_factory=session_factory, transaction_id=transaction_id) == key


def test_deleting_a_custom_category_leaves_its_transactions_uncategorized(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    key = _create(http_client=http_client)
    manual = persist_transaction(
        session_factory=session_factory, account_id=account_id, category=key, category_source=CategorySource.MANUAL
    )
    ruled = persist_transaction(session_factory=session_factory, account_id=account_id, other_party="Alnatura")
    http_client.post("/api/categorization/rules", json={"pattern": "alnatura", "category": key})
    rule_response = http_client.post(
        "/api/notification_rules",
        json={
            "trigger": "transaction",
            "enabled": True,
            "include_content": True,
            "account_ids": [account_id],
            "categories": [key, "FUEL"],
            "types": ["OUTGOING"],
        },
    )
    assert rule_response.status_code == 201, rule_response.text

    response = http_client.delete(f"{URL}/{key}")

    assert response.status_code == 200
    assert response.json()["custom_categories"] == []
    assert _category_of(session_factory=session_factory, transaction_id=manual) == TransactionCategory.UNKNOWN
    assert _category_of(session_factory=session_factory, transaction_id=ruled) == TransactionCategory.UNKNOWN
    assert http_client.get("/api/categorization").json()["rules"] == []
    assert http_client.get("/api/notification_rules").json()[-1]["categories"] == ["FUEL"]


def test_custom_categories_of_another_user_cannot_be_changed(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)
    key = _create(http_client=http_client)

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

    assert http_client.get(URL).json()["custom_categories"] == []
    assert http_client.put(f"{URL}/{key}", json={"group": "SHOPPING", "name": "x"}).status_code == 404
    assert http_client.delete(f"{URL}/{key}").status_code == 404
    assert http_client.post("/api/categorization/rules", json={"pattern": "abc", "category": key}).status_code == 422


def test_a_shared_user_sees_and_may_assign_the_owners_custom_categories(http_client: TestClient):
    recipient_id = register(http_client, user_name=SECOND_USER_NAME, display_name=SECOND_DISPLAY_NAME).json()["id"]
    register_and_login(http_client)
    account_id = setup_manual_account(http_client)
    key = _create(http_client=http_client)
    transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions", json={"amount": -DEFAULT_AMOUNT, "date": str(RECENT_DATE)}
    ).json()["id"]
    share_id = http_client.post(
        f"/api/account_shares/account/{account_id}", json={"user_id": recipient_id, "permission": "write"}
    ).json()["id"]
    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    http_client.post(f"/api/account_shares/{share_id}/accept")
    own_key = _create(http_client=http_client, name="Mein Laden")

    visible = http_client.get(URL).json()["custom_categories"]

    assert {(custom["key"], custom["owned"]) for custom in visible} == {(key, False), (own_key, True)}
    patch_url = f"/api/account/{account_id}/transactions/{transaction_id}"
    assert http_client.patch(patch_url, json={"category": key}).status_code == 200
    assert http_client.patch(patch_url, json={"category": own_key}).status_code == 422
