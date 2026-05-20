from datetime import date, timedelta

from fastapi.testclient import TestClient
from source.backend.models.account import Account
from source.backend.models.account_balance_snapshot import AccountBalanceSnapshot
from source.backend.models.transaction import Transaction
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import create_credential, login_as, register


def _account_with_history(
    session_factory: sessionmaker, credential_id: int, day_count: int, transactions_per_day: int = 1
) -> int:
    """Account with `day_count` distinct transaction days (newest = 2026-05-01)."""
    with session_factory() as session:
        account = Account(credential_id=credential_id, name="DE00 1234", balance=0.0)
        session.add(account)
        session.flush()
        base = date(year=2026, month=5, day=1)
        for day_offset in range(day_count):
            day = base - timedelta(days=day_offset)
            for index in range(transactions_per_day):
                session.add(
                    Transaction(
                        account_id=account.id,
                        amount=float(index + 1),
                        purpose=f"d{day_offset}-t{index}",
                        other_party=None,
                        date=day,
                    )
                )
            session.add(AccountBalanceSnapshot(account_id=account.id, date=day, balance=100.0 - day_offset))
        session.commit()
        return account.id


def test_history_default_page_returns_first_thirty_days_newest_first(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _account_with_history(session_factory=session_factory, credential_id=credential_id, day_count=40)

    body = http_client.get(f"/account/{account_id}/history").json()

    assert body["page"] == 1
    assert body["page_size"] == 30
    assert body["total_days"] == 40
    assert len(body["balance_at_date"]) == 30
    assert "2026-05-01" in body["balance_at_date"]  # newest day on page 1
    # Day 30 (zero-indexed: 2026-05-01 minus 29 days) is the oldest on page 1.
    assert "2026-04-02" in body["balance_at_date"]
    # Day 31 (2026-04-01) belongs to page 2.
    assert "2026-04-01" not in body["balance_at_date"]


def test_history_page_size_controls_day_window(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    # 5 days, 3 transactions each → 15 transactions; page_size=2 should return
    # 2 days = 6 transactions.
    account_id = _account_with_history(
        session_factory=session_factory,
        credential_id=credential_id,
        day_count=5,
        transactions_per_day=3,
    )

    body = http_client.get(f"/account/{account_id}/history", params={"page_size": 2}).json()

    assert body["total_days"] == 5
    assert body["page_size"] == 2
    assert set(body["balance_at_date"]) == {"2026-05-01", "2026-04-30"}
    assert len(body["transactions"]) == 6
    # Transactions are sorted newest day first.
    assert [transaction["date"] for transaction in body["transactions"]] == [
        "2026-05-01",
        "2026-05-01",
        "2026-05-01",
        "2026-04-30",
        "2026-04-30",
        "2026-04-30",
    ]


def test_history_second_page_returns_next_day_window(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _account_with_history(session_factory=session_factory, credential_id=credential_id, day_count=5)

    page_one = http_client.get(f"/account/{account_id}/history", params={"page_size": 2}).json()
    page_two = http_client.get(f"/account/{account_id}/history", params={"page": 2, "page_size": 2}).json()

    assert set(page_one["balance_at_date"]) == {"2026-05-01", "2026-04-30"}
    assert set(page_two["balance_at_date"]) == {"2026-04-29", "2026-04-28"}
    assert set(page_one["balance_at_date"]).isdisjoint(set(page_two["balance_at_date"]))


def test_history_page_beyond_data_is_empty(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _account_with_history(session_factory=session_factory, credential_id=credential_id, day_count=3)

    body = http_client.get(f"/account/{account_id}/history", params={"page": 5, "page_size": 10}).json()

    assert body["total_days"] == 3
    assert body["transactions"] == []
    assert body["balance_at_date"] == {}


def test_history_empty_account_returns_zero_total_days(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    with session_factory() as session:
        account = Account(credential_id=credential_id, name="empty", balance=0.0)
        session.add(account)
        session.commit()
        account_id = account.id

    body = http_client.get(f"/account/{account_id}/history").json()

    assert body == {"transactions": [], "balance_at_date": {}, "page": 1, "page_size": 30, "total_days": 0}


def test_history_rejects_invalid_pagination_parameters(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _account_with_history(session_factory=session_factory, credential_id=credential_id, day_count=1)

    assert http_client.get(f"/account/{account_id}/history", params={"page": 0}).status_code == 422
    assert http_client.get(f"/account/{account_id}/history", params={"page_size": 0}).status_code == 422
    assert http_client.get(f"/account/{account_id}/history", params={"page_size": 9999}).status_code == 422


def test_history_requires_authentication(http_client: TestClient):
    assert http_client.get("/account/1/history").status_code == 401


def test_user_cannot_read_other_users_history(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, name="alice")
    credential_id = create_credential(http_client).json()["id"]
    account_id = _account_with_history(session_factory=session_factory, credential_id=credential_id, day_count=1)

    register(http_client, name="bob")
    login_as(http_client, name="bob")

    assert http_client.get(f"/account/{account_id}/history").status_code == 404
