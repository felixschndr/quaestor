from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    persist_transaction,
    register,
    setup_account,
    setup_manual_account,
)


def test_create_expected_transaction_returns_201_with_fields(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 250.0, "other_party": "ACME", "note": "salary", "match_tolerance_percent": 10},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["amount"] == 250.0
    assert body["other_party"] == "ACME"
    assert body["note"] == "salary"
    assert body["match_tolerance_percent"] == 10


def test_create_expected_transaction_rejects_invalid_tolerance(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 100.0, "match_tolerance_percent": 7},
    )

    assert response.status_code == 422


def test_create_expected_transaction_rejects_zero_amount(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 0, "match_tolerance_percent": 0},
    )

    assert response.status_code == 422


def test_create_expected_transaction_on_manual_account_returns_403(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 100.0, "match_tolerance_percent": 0},
    )

    assert response.status_code == 403


def test_list_expected_transactions_returns_created_ones(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 10.0, "match_tolerance_percent": 0},
    )
    http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 20.0, "match_tolerance_percent": 5},
    )

    response = http_client.get(f"/api/account/{account_id}/expected-transactions")

    assert response.status_code == 200
    assert {row["amount"] for row in response.json()} == {10.0, 20.0}


def test_update_expected_transaction_changes_fields(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    created_id = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 10.0, "match_tolerance_percent": 0},
    ).json()["id"]

    response = http_client.patch(
        f"/api/account/{account_id}/expected-transactions/{created_id}",
        json={"amount": -20.0, "other_party": "Landlord", "note": "rent", "match_tolerance_percent": 5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["amount"] == -20.0
    assert body["other_party"] == "Landlord"
    assert body["match_tolerance_percent"] == 5


def test_update_expected_transaction_rejects_invalid_tolerance(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    created_id = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 10.0, "match_tolerance_percent": 0},
    ).json()["id"]

    response = http_client.patch(
        f"/api/account/{account_id}/expected-transactions/{created_id}",
        json={"amount": 10.0, "match_tolerance_percent": 7},
    )

    assert response.status_code == 422


def test_update_unknown_expected_transaction_returns_404(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.patch(
        f"/api/account/{account_id}/expected-transactions/999999",
        json={"amount": 10.0, "match_tolerance_percent": 0},
    )

    assert response.status_code == 404


def test_delete_expected_transaction_removes_it(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    created_id = http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 10.0, "match_tolerance_percent": 0},
    ).json()["id"]

    delete_response = http_client.delete(f"/api/account/{account_id}/expected-transactions/{created_id}")

    assert delete_response.status_code == 204
    assert http_client.get(f"/api/account/{account_id}/expected-transactions").json() == []


def test_delete_unknown_expected_transaction_returns_404(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.delete(f"/api/account/{account_id}/expected-transactions/999999")

    assert response.status_code == 404


def test_expected_transactions_are_excluded_from_history(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    booked_id = persist_transaction(session_factory=session_factory, account_id=account_id, amount=-5.0)
    http_client.post(
        f"/api/account/{account_id}/expected-transactions",
        json={"amount": 99.0, "match_tolerance_percent": 0},
    )

    body = http_client.get(f"/api/account/{account_id}/history").json()

    returned_ids = {row["id"] for row in body["transactions"]}
    assert returned_ids == {booked_id}
    assert body["total_days"] == 1  # the expected transaction must not add a day


def test_search_includes_pending_but_not_expected_transactions(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    booked_id = persist_transaction(session_factory=session_factory, account_id=account_id, purpose="booked")
    pending_id = persist_transaction(
        session_factory=session_factory, account_id=account_id, purpose="vorgemerkt", pending=True
    )
    persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        purpose="erwartet",
        pending=True,
        expected=True,
        match_tolerance_percent=0,
    )

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {booked_id, pending_id}
