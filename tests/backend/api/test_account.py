from fastapi.testclient import TestClient
from source.backend.models.account import Account
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import create_credential, login_as, register


def _persist_account(session_factory: sessionmaker, credential_id: int, balance: float = 100.0) -> int:
    with session_factory() as session:
        account = Account(credential_id=credential_id, name="DE00 1234", balance=balance)
        session.add(account)
        session.commit()
        return account.id


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
