from datetime import date

import pytest
from fastapi.testclient import TestClient
from source.backend.models.account import Account
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import create_credential, login_as, register


def _persist_account(session_factory: sessionmaker, credential_id: int, balance: float = 100.0) -> int:
    with session_factory() as session:
        account = Account(credential_id=credential_id, name="DE00 1234", balance=balance)
        session.add(account)
        session.commit()
        return account.id


def _persist_transaction(
    session_factory: sessionmaker,
    account_id: int,
    amount: float = 12.34,
    purpose: str = "groceries",
    other_party: str = "Supermarket",
) -> int:
    with session_factory() as session:
        transaction = Transaction(
            account_id=account_id,
            amount=amount,
            purpose=purpose,
            other_party=other_party,
            date=date(year=2026, month=5, day=20),
        )
        session.add(transaction)
        session.commit()
        return transaction.id


def test_update_account_changes_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 50})

    assert response.status_code == 200
    assert response.json()["balance_factor"] == 50


def test_update_account_persists_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 25})

    with session_factory() as session:
        stored = session.get(entity=Account, ident=account_id)
        assert stored is not None
        assert stored.balance_factor == 25


def test_update_account_rejects_negative_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)

    assert http_client.patch(f"/api/account/{account_id}", json={"balance_factor": -1}).status_code == 422


def test_update_account_rejects_balance_factor_above_100(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)

    assert http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 101}).status_code == 422


def test_update_account_for_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 50}).status_code == 404


def test_update_account_requires_authentication(http_client: TestClient):
    assert http_client.patch("/api/account/1", json={"balance_factor": 50}).status_code == 401


def test_get_transaction_returns_transaction(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == transaction_id
    assert body["amount"] == 12.34
    assert body["purpose"] == "groceries"
    assert body["other_party"] == "Supermarket"


def test_get_transaction_returns_404_when_transaction_does_not_belong_to_account(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_a = _persist_account(session_factory=session_factory, credential_id=credential_id)
    account_b = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_a)

    assert http_client.get(f"/api/account/{account_b}/transactions/{transaction_id}").status_code == 404


def test_get_transaction_returns_404_for_unknown_transaction(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)

    assert http_client.get(f"/api/account/{account_id}/transactions/999999").status_code == 404


def test_get_transaction_for_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").status_code == 404


def test_get_transaction_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/account/1/transactions/1").status_code == 401


def test_update_transaction_set_note(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "Birthday gift"}
    )

    assert response.status_code == 200
    assert response.json()["note"] == "Birthday gift"


def test_update_transaction_persists_note(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)
    http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "Persisted"})

    with session_factory() as session:
        stored = session.get(entity=Transaction, ident=transaction_id)
        assert stored is not None
        assert stored.note == "Persisted"


def test_update_transaction_null_note_clears_existing_note(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)
    http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "to be cleared"})

    response = http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": None})

    assert response.status_code == 200
    assert response.json()["note"] is None


def test_update_transaction_returns_404_when_transaction_does_not_belong_to_account(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_a = _persist_account(session_factory=session_factory, credential_id=credential_id)
    account_b = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_a)

    assert (
        http_client.patch(f"/api/account/{account_b}/transactions/{transaction_id}", json={"note": "x"}).status_code
        == 404
    )


def test_update_transaction_for_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert (
        http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "x"}).status_code
        == 404
    )


def test_update_transaction_requires_authentication(http_client: TestClient):
    assert http_client.patch("/api/account/1/transactions/1", json={"note": "x"}).status_code == 401


def test_get_transaction_returns_default_unknown_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    assert http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").json()["category"] == "UNKNOWN"


def test_update_transaction_sets_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"category": "SUPERMARKET"}
    )

    assert response.status_code == 200
    assert response.json()["category"] == "SUPERMARKET"
    with session_factory() as session:
        stored = session.get(entity=Transaction, ident=transaction_id)
        assert stored is not None
        assert stored.category == TransactionCategory.SUPERMARKET


def test_update_transaction_rejects_unknown_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"category": "NOT_A_REAL_CATEGORY"}
    )

    assert response.status_code == 422


def test_update_transaction_logs_category_override(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(
        session_factory=session_factory, account_id=account_id, other_party="Some Tiny Cafe"
    )

    with caplog.at_level("INFO", logger="source.backend.services.account_service"):
        http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"category": "DRUGSTORE"})

    override_logs = [r for r in caplog.records if "Category override" in r.message]
    assert override_logs, "expected a 'Category override' log line"
    log_message = override_logs[0].message
    assert "previous=UNKNOWN" in log_message
    assert "new=DRUGSTORE" in log_message
    assert "Some Tiny Cafe" in log_message


def test_update_transaction_does_not_log_override_when_category_unchanged(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = _persist_transaction(session_factory=session_factory, account_id=account_id)

    with caplog.at_level("INFO", logger="source.backend.services.account_service"):
        http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "just a note"})

    assert not any("Category override" in r.message for r in caplog.records)
