from datetime import date, timedelta

from fastapi.testclient import TestClient
from source.backend.models.account import Account
from source.backend.models.transaction import Transaction
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import create_credential, login_as, register


def _create_account_and_fill_with_transactions(session_factory: sessionmaker, credential_id: int, count: int) -> int:
    with session_factory() as session:
        account = Account(credential_id=credential_id, name="DE00 1234")
        session.add(account)
        session.flush()
        base = date(year=2026, month=5, day=1)
        for index in range(count):
            session.add(
                Transaction(
                    account_id=account.id,
                    amount=float(index),
                    purpose=f"purpose {index}",
                    date=base - timedelta(days=index),
                    other_party=f"recipient {index}",
                )
            )
        session.commit()
        return account.id


def test_list_transactions_returns_newest_first(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _create_account_and_fill_with_transactions(
        session_factory=session_factory, credential_id=credential_id, count=3
    )

    response = http_client.get(f"/transactions/{account_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 50
    assert [t["date"] for t in body["items"]] == ["2026-05-01", "2026-04-30", "2026-04-29"]


def test_list_transactions_defaults_to_50_newest(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _create_account_and_fill_with_transactions(
        session_factory=session_factory, credential_id=credential_id, count=60
    )

    body = http_client.get(f"/transactions/{account_id}").json()

    assert body["total"] == 60
    assert len(body["items"]) == 50
    assert body["items"][0]["date"] == "2026-05-01"  # newest


def test_list_transactions_supports_pagination(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _create_account_and_fill_with_transactions(
        session_factory=session_factory, credential_id=credential_id, count=5
    )

    page1 = http_client.get(f"/transactions/{account_id}", params={"page": 1, "page_size": 2}).json()
    page2 = http_client.get(f"/transactions/{account_id}", params={"page": 2, "page_size": 2}).json()
    page3 = http_client.get(f"/transactions/{account_id}", params={"page": 3, "page_size": 2}).json()

    assert [t["purpose"] for t in page1["items"]] == ["purpose 0", "purpose 1"]
    assert [t["purpose"] for t in page2["items"]] == ["purpose 2", "purpose 3"]
    assert [t["purpose"] for t in page3["items"]] == ["purpose 4"]
    assert page2["total"] == 5


def test_list_transactions_rejects_invalid_pagination(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _create_account_and_fill_with_transactions(
        session_factory=session_factory, credential_id=credential_id, count=1
    )

    assert http_client.get(f"/transactions/{account_id}", params={"page": 0}).status_code == 422
    assert http_client.get(f"/transactions/{account_id}", params={"page_size": 0}).status_code == 422
    assert http_client.get(f"/transactions/{account_id}", params={"page_size": 999}).status_code == 422


def test_list_transactions_requires_authentication(http_client: TestClient):
    assert http_client.get("/transactions/1").status_code == 401


def test_user_cannot_read_other_users_transactions(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, name="alice")
    credential_id = create_credential(http_client).json()["id"]
    account_id = _create_account_and_fill_with_transactions(
        session_factory=session_factory, credential_id=credential_id, count=1
    )

    register(http_client, name="bob")
    login_as(http_client, name="bob")

    assert http_client.get(f"/transactions/{account_id}").status_code == 404
