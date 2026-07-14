from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.models.transactions.transaction_category import TransactionCategory
from tests.backend.conftest import (
    OLDER_DATE,
    SECOND_USER_NAME,
    assert_log_contains,
    login_as,
    persist_transaction,
    register,
    setup_account,
)


def _create_contract(http_client: TestClient, account_id: int, name: str = "Gym") -> dict:
    response = http_client.post("/api/contracts", json={"name": name, "account_id": account_id, "category": "FITNESS"})
    assert response.status_code == 201
    return response.json()


def test_create_and_list_contract(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    created = _create_contract(http_client, account_id=account_id)

    assert created["name"] == "Gym"
    assert created["category"] == "FITNESS"
    assert created["source"] == "MANUAL"
    assert created["member_count"] == 0
    assert_log_contains(caplog, messages=["Created manual", "<Contract("])

    listed = http_client.get("/api/contracts").json()
    assert [contract["id"] for contract in listed] == [created["id"]]


def test_create_contract_with_frequency(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.post(
        "/api/contracts", json={"name": "Miete", "account_id": account_id, "frequency": "MONTHLY"}
    )

    assert response.status_code == 201
    assert response.json()["frequency"] == "MONTHLY"


def test_changing_the_turnus_of_a_manual_contract(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    contract = http_client.post(
        "/api/contracts", json={"name": "Miete", "account_id": account_id, "frequency": "MONTHLY"}
    ).json()
    for offset in [0, 30, 60, 90]:
        transaction_id = persist_transaction(
            session_factory, account_id=account_id, date=OLDER_DATE + timedelta(days=offset)
        )
        http_client.post(f"/api/contracts/{contract['id']}/transactions", json={"transaction_id": transaction_id})

    updated = http_client.patch(f"/api/contracts/{contract['id']}", json={"name": "Miete", "frequency": "QUARTERLY"})

    assert updated.status_code == 200
    assert updated.json()["frequency"] == "QUARTERLY"
    assert updated.json()["interval_days"] == 91

    transaction_id = persist_transaction(session_factory, account_id=account_id, date=OLDER_DATE + timedelta(days=120))
    assigned = http_client.post(
        f"/api/contracts/{contract['id']}/transactions", json={"transaction_id": transaction_id}
    )
    assert assigned.json()["frequency"] == "QUARTERLY"

    cleared = http_client.patch(f"/api/contracts/{contract['id']}", json={"name": "Miete", "frequency": None})
    assert cleared.json()["frequency"] == "MONTHLY"


def test_assign_and_remove_transaction(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory, account_id=account_id)
    contract = _create_contract(http_client, account_id=account_id)

    assigned = http_client.post(
        f"/api/contracts/{contract['id']}/transactions", json={"transaction_id": transaction_id}
    )
    assert assigned.status_code == 200
    body = assigned.json()
    assert body["member_count"] == 1
    member = body["members"][0]
    assert member["id"] == transaction_id
    assert member["contract_assignment"] == "MANUAL"
    assert member["is_outlier"] is False

    removed = http_client.delete(f"/api/contracts/{contract['id']}/transactions/{transaction_id}")
    assert removed.status_code == 200
    assert removed.json()["member_count"] == 0


def test_reassigning_transaction_moves_it_between_contracts(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory, account_id=account_id)
    contract_a = _create_contract(http_client, account_id=account_id, name="A")
    contract_b = _create_contract(http_client, account_id=account_id, name="B")

    http_client.post(f"/api/contracts/{contract_a['id']}/transactions", json={"transaction_id": transaction_id})
    moved = http_client.post(f"/api/contracts/{contract_b['id']}/transactions", json={"transaction_id": transaction_id})

    assert moved.status_code == 200
    assert [member["id"] for member in moved.json()["members"]] == [transaction_id]
    assert http_client.get(f"/api/contracts/{contract_a['id']}").json()["member_count"] == 0


def test_removing_transaction_detaches_it_from_the_contract(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory, account_id=account_id)
    contract = _create_contract(http_client, account_id=account_id)
    http_client.post(f"/api/contracts/{contract['id']}/transactions", json={"transaction_id": transaction_id})

    http_client.delete(f"/api/contracts/{contract['id']}/transactions/{transaction_id}")

    detail = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").json()
    assert detail["contract_id"] is None


def test_update_and_delete_contract(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    contract = _create_contract(http_client, account_id=account_id)

    updated = http_client.patch(
        f"/api/contracts/{contract['id']}", json={"name": "Fitness First", "category": "FITNESS"}
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Fitness First"

    assert http_client.delete(f"/api/contracts/{contract['id']}").status_code == 204
    assert http_client.get(f"/api/contracts/{contract['id']}").status_code == 404


def test_contract_note(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    contract = _create_contract(http_client, account_id=account_id)
    assert contract["note"] is None

    updated = http_client.patch(
        f"/api/contracts/{contract['id']}",
        json={"name": contract["name"], "category": "FITNESS", "note": "Cancel before June"},
    )
    assert updated.status_code == 200
    assert updated.json()["note"] == "Cancel before June"

    assert http_client.get(f"/api/contracts/{contract['id']}").json()["note"] == "Cancel before June"


def test_rename_preserves_existing_note(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    contract = _create_contract(http_client, account_id=account_id)
    http_client.patch(f"/api/contracts/{contract['id']}", json={"name": "Gym", "note": "keep me"})

    renamed = http_client.patch(f"/api/contracts/{contract['id']}", json={"name": "New Gym", "category": "FITNESS"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "New Gym"
    assert renamed.json()["note"] == "keep me"


def test_changing_contract_category_reassigns_member_transactions(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(
        session_factory, account_id=account_id, category=TransactionCategory.ONLINE_SHOPPING
    )
    contract = _create_contract(http_client, account_id=account_id)
    http_client.post(f"/api/contracts/{contract['id']}/transactions", json={"transaction_id": transaction_id})

    updated = http_client.patch(f"/api/contracts/{contract['id']}", json={"name": "Gym", "category": "FITNESS"})

    assert updated.status_code == 200
    detail = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").json()
    assert detail["category"] == "FITNESS"


def test_assigning_transaction_to_categorised_contract_applies_its_category(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(
        session_factory, account_id=account_id, category=TransactionCategory.ONLINE_SHOPPING
    )
    contract = _create_contract(http_client, account_id=account_id)

    http_client.post(f"/api/contracts/{contract['id']}/transactions", json={"transaction_id": transaction_id})

    detail = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").json()
    assert detail["category"] == "FITNESS"


def test_contract_of_other_user_is_not_accessible(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    contract = _create_contract(http_client, account_id=account_id)

    register(http_client, user_name=SECOND_USER_NAME)
    login_as(http_client, user_name=SECOND_USER_NAME)

    assert http_client.get(f"/api/contracts/{contract['id']}").status_code == 404
    assert http_client.get("/api/contracts").json() == []
