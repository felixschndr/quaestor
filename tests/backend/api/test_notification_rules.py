from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import assert_log_contains, setup_account


def _balance_rule_payload(account_id: int, **overrides: Any) -> dict:
    payload = {
        "trigger": "balance_threshold",
        "name": "Low balance",
        "account_ids": [account_id],
        "threshold": 100.0,
        "direction": "below",
    }
    payload.update(overrides)
    return payload


def _transaction_rule_payload(account_id: int, **overrides: Any) -> dict:
    payload = {
        "trigger": "transaction",
        "account_ids": [account_id],
        "other_party_contains": "Netflix",
        "categories": ["SUBSCRIPTIONS"],
        "types": ["OUTGOING"],
        "min_amount": -50.0,
        "max_amount": -1.0,
    }
    payload.update(overrides)
    return payload


def test_create_and_list_balance_rule(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post("/api/notification_rules", json=_balance_rule_payload(account_id))

    assert response.status_code == 201
    assert_log_contains(caplog, messages=["Created", "<NotificationRule(", "default notification rules for"])
    created = response.json()
    assert created["trigger"] == "balance_threshold"
    assert created["threshold"] == 100.0
    assert created["direction"] == "below"
    assert created["account_ids"] == [account_id]
    assert created["name"] == "Low balance"
    assert created["include_content"] is True

    listed = http_client.get("/api/notification_rules").json()
    assert created["id"] in [rule["id"] for rule in listed]


def test_create_and_list_contract_overdue_rule(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post(
        "/api/notification_rules",
        json={"trigger": "contract_overdue", "name": "Overdue", "account_ids": [account_id]},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["trigger"] == "contract_overdue"
    assert created["account_ids"] == [account_id]
    assert created["name"] == "Overdue"


def test_create_rule_can_opt_out_of_content(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    created = http_client.post(
        "/api/notification_rules", json=_balance_rule_payload(account_id, include_content=False)
    ).json()

    assert created["include_content"] is False


def test_create_transaction_rule_round_trips_criteria(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    created = http_client.post("/api/notification_rules", json=_transaction_rule_payload(account_id)).json()

    assert created["trigger"] == "transaction"
    assert created["categories"] == ["SUBSCRIPTIONS"]
    assert created["types"] == ["OUTGOING"]
    assert created["other_party_contains"] == "Netflix"
    assert created["min_amount"] == -50.0


def test_update_rule(http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    rule_id = http_client.post("/api/notification_rules", json=_balance_rule_payload(account_id)).json()["id"]

    response = http_client.put(
        f"/api/notification_rules/{rule_id}",
        json=_balance_rule_payload(account_id, threshold=42.0, enabled=False, name="Updated"),
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["threshold"] == 42.0
    assert updated["enabled"] is False
    assert updated["name"] == "Updated"
    assert_log_contains(caplog, message="Updated Notificationrule: enabled: True → False")


def test_delete_rule(http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    rule_id = http_client.post("/api/notification_rules", json=_balance_rule_payload(account_id)).json()["id"]

    assert http_client.delete(f"/api/notification_rules/{rule_id}").status_code == 204
    assert rule_id not in [rule["id"] for rule in http_client.get("/api/notification_rules").json()]
    assert_log_contains(caplog, message="Deleted notification rule")


def test_create_rule_with_empty_accounts_means_all(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post("/api/notification_rules", json=_balance_rule_payload(account_id=0, account_ids=[]))

    assert response.status_code == 201
    assert response.json()["account_ids"] == []


def test_create_rule_rejects_foreign_account(http_client: TestClient, session_factory: sessionmaker):
    setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post(
        "/api/notification_rules", json=_balance_rule_payload(account_id=0, account_ids=[999999])
    )

    assert response.status_code == 404


def test_unknown_rule_returns_404(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    assert http_client.delete("/api/notification_rules/999999").status_code == 404
    assert http_client.put("/api/notification_rules/999999", json=_balance_rule_payload(account_id)).status_code == 404
    assert_log_contains(caplog, message="attempted to access notification rule 999999 which is not theirs")
