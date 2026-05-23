from datetime import date

from fastapi.testclient import TestClient
from source.backend.models.account import Account
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import create_credential, login_as, register


def _persist_account(session_factory: sessionmaker, credential_id: int) -> int:
    with session_factory() as session:
        account = Account(credential_id=credential_id, name="DE00 1234", balance=0.0)
        session.add(account)
        session.commit()
        return account.id


def _seed_three_transactions(session_factory: sessionmaker, account_id: int) -> dict[str, int]:
    with session_factory() as session:
        rewe = Transaction(
            account_id=account_id,
            amount=-12.50,
            purpose="Wocheneinkauf",
            other_party="Rewe",
            date=date(year=2026, month=1, day=15),
            transaction_type=TransactionType.OUTGOING,
            category=TransactionCategory.SUPERMARKET,
            note="weekly groceries",
        )
        salary = Transaction(
            account_id=account_id,
            amount=2500.00,
            purpose="Gehalt April",
            other_party="ACME GmbH",
            date=date(year=2026, month=4, day=30),
            transaction_type=TransactionType.INCOMING,
            category=TransactionCategory.SALARY,
            note=None,
        )
        atm = Transaction(
            account_id=account_id,
            amount=-200.00,
            purpose="ATM Berlin",
            other_party="Sparkasse",
            date=date(year=2026, month=5, day=2),
            transaction_type=TransactionType.OUTGOING,
            category=TransactionCategory.WITHDRAWAL,
            note="vacation cash",
        )
        session.add_all([rewe, salary, atm])
        session.commit()
        return {"rewe": rewe.id, "salary": salary.id, "atm": atm.id}


def test_search_without_filters_returns_all(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions")

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == set(ids.values())


def test_search_by_text_matches_purpose_case_insensitively(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"text": "GEHALT"})

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [ids["salary"]]


def test_search_by_text_also_matches_other_party(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"text": "rewe"})

    assert [row["id"] for row in response.json()] == [ids["rewe"]]


def test_search_by_text_also_matches_note(http_client: TestClient, session_factory: sessionmaker):
    # Per UX spec: the free-text search should be the *one* search box that
    # covers everything a human would scan — including the note. The atm
    # fixture is the only row whose note contains "vacation".
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"text": "vacation"})

    assert [row["id"] for row in response.json()] == [ids["atm"]]


def test_search_by_amount_range(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"amount_from": 0, "amount_to": 5000})

    assert [row["id"] for row in response.json()] == [ids["salary"]]


def test_search_by_date_range(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        f"/api/account/{account_id}/transactions",
        params={"date_from": "2026-04-01", "date_to": "2026-04-30"},
    )

    assert [row["id"] for row in response.json()] == [ids["salary"]]


def test_search_by_transaction_type(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"transaction_type": "OUTGOING"})

    assert {row["id"] for row in response.json()} == {ids["rewe"], ids["atm"]}


def test_search_by_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"category": "WITHDRAWAL"})

    assert [row["id"] for row in response.json()] == [ids["atm"]]


def test_search_by_note_substring(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"note": "vacation"})

    assert [row["id"] for row in response.json()] == [ids["atm"]]


def test_search_combines_filters_with_and(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        f"/api/account/{account_id}/transactions",
        params={"transaction_type": "OUTGOING", "amount_from": -50},
    )

    assert [row["id"] for row in response.json()] == [ids["rewe"]]


def test_search_returns_empty_when_no_match(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"text": "no such transaction"})

    assert response.status_code == 200
    assert response.json() == []


def test_search_rejects_unknown_transaction_type(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        f"/api/account/{account_id}/transactions", params={"transaction_type": "NOT_A_REAL_TYPE"}
    )

    assert response.status_code == 422


def test_search_rejects_unknown_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/account/{account_id}/transactions", params={"category": "NOT_A_REAL_CATEGORY"})

    assert response.status_code == 422


def test_search_on_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = _persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.get(f"/api/account/{account_id}/transactions").status_code == 404


def test_search_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/account/1/transactions").status_code == 401
