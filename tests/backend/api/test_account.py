from datetime import date, timedelta

from fastapi.testclient import TestClient
from source.backend.api.schemas.transaction import TransactionDetailRead
from source.backend.bank_handlers import BankProvider
from source.backend.models.account import Account
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    SECOND_USER_NAME,
    USER_NAME,
    create_credential,
    login_as,
    make_credential,
    make_user,
    persist_account,
    persist_transaction,
    register,
    setup_manual_account,
)


def _create_manual_account_payload(credential_id: int) -> dict:
    return {"credential_id": credential_id, "name": "Wallet", "balance": 50.0}


def test_create_manual_account_succeeds_on_owned_manual_credential(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client, bank="manual", credentials={}).json()["id"]

    response = http_client.post("/api/account", json=_create_manual_account_payload(credential_id))

    assert response.status_code == 201
    assert response.json()["name"] == "Wallet"
    assert response.json()["balance"] == 50.0


def test_create_manual_account_with_unknown_credential_returns_404(http_client: TestClient):
    register(http_client)

    response = http_client.post("/api/account", json=_create_manual_account_payload(999999))

    assert response.status_code == 404


def test_create_manual_account_with_other_users_credential_returns_404(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    with session_factory() as session:
        other = make_user(session, user_name=SECOND_USER_NAME, display_name="Other")
        foreign_credential = make_credential(session, user_id=other.id, bank=BankProvider.MANUAL, credentials={})
        session.commit()
        foreign_credential_id = foreign_credential.id

    response = http_client.post("/api/account", json=_create_manual_account_payload(foreign_credential_id))

    assert response.status_code == 404


def test_create_manual_account_on_non_manual_credential_returns_403(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.post("/api/account", json=_create_manual_account_payload(credential_id))

    assert response.status_code == 403


def test_update_account_changes_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 50})

    assert response.status_code == 200
    assert response.json()["balance_factor"] == 50


def test_update_account_persists_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 25})

    with session_factory() as session:
        stored = session.get(entity=Account, ident=account_id)
        assert stored is not None
        assert stored.balance_factor == 25


def test_update_account_rejects_negative_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    assert http_client.patch(f"/api/account/{account_id}", json={"balance_factor": -1}).status_code == 422


def test_update_account_rejects_balance_factor_above_100(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    assert http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 101}).status_code == 422


def test_update_account_for_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 50}).status_code == 404


def test_update_account_requires_authentication(http_client: TestClient):
    assert http_client.patch("/api/account/1", json={"balance_factor": 50}).status_code == 401


def test_account_response_has_null_display_name_by_default(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 100})

    assert response.status_code == 200
    assert response.json()["display_name"] is None


def test_update_account_sets_display_name(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"display_name": "Hauptkonto"})

    assert response.status_code == 200
    assert response.json()["display_name"] == "Hauptkonto"
    with session_factory() as session:
        stored = session.get(entity=Account, ident=account_id)
        assert stored is not None
        assert stored.display_name == "Hauptkonto"


def test_update_account_clears_display_name_with_null(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    http_client.patch(f"/api/account/{account_id}", json={"display_name": "to be cleared"})

    response = http_client.patch(f"/api/account/{account_id}", json={"display_name": None})

    assert response.status_code == 200
    assert response.json()["display_name"] is None
    with session_factory() as session:
        stored = session.get(entity=Account, ident=account_id)
        assert stored is not None
        assert stored.display_name is None


def test_update_account_rejects_overlong_display_name(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"display_name": "x" * 151})

    assert response.status_code == 422


def test_update_account_accepts_display_name_at_max_length(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"display_name": "x" * 150})

    assert response.status_code == 200
    assert response.json()["display_name"] == "x" * 150


def test_update_account_display_name_alone_leaves_balance_factor_untouched(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 42})

    response = http_client.patch(f"/api/account/{account_id}", json={"display_name": "Sparkonto"})

    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Sparkonto"
    assert body["balance_factor"] == 42


def test_update_account_balance_factor_alone_leaves_display_name_untouched(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    http_client.patch(f"/api/account/{account_id}", json={"display_name": "Bleibt"})

    response = http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 25})

    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Bleibt"
    assert body["balance_factor"] == 25


def test_update_account_null_balance_factor_is_ignored(http_client: TestClient, session_factory: sessionmaker):
    # balance_factor is non-nullable in the DB; an explicit null must be a no-op
    # rather than producing a 500 at commit time.
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    http_client.patch(f"/api/account/{account_id}", json={"balance_factor": 75})

    response = http_client.patch(f"/api/account/{account_id}", json={"balance_factor": None})

    assert response.status_code == 200
    assert response.json()["balance_factor"] == 75


def test_get_transaction_returns_transaction(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(
        session_factory=session_factory,
        account_id=account_id,
        amount=12.34,
        purpose="groceries",
        other_party="Supermarket",
    )

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
    account_a = persist_account(session_factory=session_factory, credential_id=credential_id)
    account_b = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_a)

    assert http_client.get(f"/api/account/{account_b}/transactions/{transaction_id}").status_code == 404


def test_get_transaction_returns_404_for_unknown_transaction(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    assert http_client.get(f"/api/account/{account_id}/transactions/999999").status_code == 404


def test_get_transaction_for_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").status_code == 404


def test_get_transaction_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/account/1/transactions/1").status_code == 401


def test_update_transaction_set_note(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "Birthday gift"}
    )

    assert response.status_code == 200
    assert response.json()["note"] == "Birthday gift"


def test_update_transaction_rejects_editing_pending(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id, pending=True)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "should fail"}
    )

    assert response.status_code == 422
    with session_factory() as session:
        assert session.get(entity=Transaction, ident=transaction_id).note is None


def test_pending_flag_is_exposed_in_transaction_read(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id, pending=True)

    response = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}")

    assert response.status_code == 200
    assert response.json()["pending"] is True


def test_update_transaction_persists_note(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)
    http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "Persisted"})

    with session_factory() as session:
        stored = session.get(entity=Transaction, ident=transaction_id)
        assert stored is not None
        assert stored.note == "Persisted"


def test_update_transaction_null_note_clears_existing_note(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)
    http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "to be cleared"})

    response = http_client.patch(f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": None})

    assert response.status_code == 200
    assert response.json()["note"] is None


def test_update_transaction_returns_404_when_transaction_does_not_belong_to_account(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_a = persist_account(session_factory=session_factory, credential_id=credential_id)
    account_b = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_a)

    assert (
        http_client.patch(f"/api/account/{account_b}/transactions/{transaction_id}", json={"note": "x"}).status_code
        == 404
    )


def test_update_transaction_for_other_users_account_returns_404(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

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
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    assert http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}").json()["category"] == "UNKNOWN"


def test_update_transaction_sets_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

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
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"category": "NOT_A_REAL_CATEGORY"}
    )

    assert response.status_code == 422


# --- Manual accounts -------------------------------------------------------


def _create_manual_credential(http_client: TestClient) -> int:
    return create_credential(http_client, bank="manual", credentials={}).json()["id"]


def test_create_manual_account_returns_persisted_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = _create_manual_credential(http_client)

    response = http_client.post(
        "/api/account",
        json={
            "credential_id": credential_id,
            "name": "Wallet",
            "display_name": "Cash wallet",
            "balance": 250.0,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Wallet"
    assert body["display_name"] == "Cash wallet"
    assert body["balance"] == 250.0
    assert body["balance_factor"] == 100
    with session_factory() as session:
        assert session.get(entity=Account, ident=body["id"]) is not None


def test_create_manual_account_rejects_non_manual_credential(http_client: TestClient):
    register(http_client)
    ing_credential_id = create_credential(http_client).json()["id"]

    response = http_client.post(
        "/api/account",
        json={"credential_id": ing_credential_id, "name": "Bogus"},
    )

    assert response.status_code == 403


def test_create_manual_account_rejects_credential_of_other_user(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name=USER_NAME)
    first_user_credential_id = _create_manual_credential(http_client)

    register(http_client, user_name=SECOND_USER_NAME)
    login_as(http_client, user_name=SECOND_USER_NAME)

    response = http_client.post(
        "/api/account",
        json={"credential_id": first_user_credential_id, "name": "Stolen"},
    )

    assert response.status_code == 404
    with session_factory() as session:
        assert (
            len(
                [
                    account
                    for account in session.query(Account).all()
                    if account.credential_id == first_user_credential_id
                ]
            )
            == 0
        )


def test_create_manual_account_requires_authentication(http_client: TestClient):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    http_client.cookies.delete("session")

    response = http_client.post("/api/account", json={"credential_id": credential_id, "name": "Wallet"})

    assert response.status_code == 401


def test_create_transaction_appends_to_manual_account_and_updates_balance(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0},
    ).json()["id"]

    response = http_client.post(
        f"/api/account/{account_id}/transactions",
        json={
            "amount": -42.50,
            "date": "2026-05-20",
            "purpose": "Lunch",
            "other_party": "Joe's Diner",
            "transaction_type": "OUTGOING",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["amount"] == -42.50
    assert body["other_party"] == "Joe's Diner"
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 100 + -42.50
        assert len(account.transactions) == 1


def test_create_transaction_rejects_non_manual_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    ing_credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=ing_credential_id)

    response = http_client.post(
        f"/api/account/{account_id}/transactions",
        json={"amount": 10.0, "date": "2026-05-20"},
    )

    assert response.status_code == 403


def test_create_transaction_requires_account_to_belong_to_user(http_client: TestClient):
    register(http_client, user_name=USER_NAME)
    credential_id = _create_manual_credential(http_client)
    first_account_account_id = http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": f"{USER_NAME}'s Wallet"},
    ).json()["id"]

    register(http_client, user_name=SECOND_USER_NAME)
    login_as(http_client, user_name=SECOND_USER_NAME)

    response = http_client.post(
        f"/api/account/{first_account_account_id}/transactions",
        json={"amount": 10.0, "date": "2026-05-20"},
    )

    assert response.status_code == 404


def test_delete_transaction_removes_it_and_restores_balance(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0},
    ).json()["id"]
    transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions",
        json={"amount": -25.0, "date": "2026-05-20"},
    ).json()["id"]

    response = http_client.delete(f"/api/account/{account_id}/transactions/{transaction_id}")

    assert response.status_code == 204
    with session_factory() as session:
        assert session.get(entity=Transaction, ident=transaction_id) is None
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 100.0


def test_delete_transaction_rejects_non_manual_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    ing_credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=ing_credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.delete(f"/api/account/{account_id}/transactions/{transaction_id}")

    assert response.status_code == 403


def test_delete_account_removes_manual_account_with_its_transactions(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0},
    ).json()["id"]
    http_client.post(
        f"/api/account/{account_id}/transactions",
        json={"amount": -10.0, "date": "2026-05-20"},
    )

    response = http_client.delete(f"/api/account/{account_id}")

    assert response.status_code == 204
    with session_factory() as session:
        assert session.get(entity=Account, ident=account_id) is None
        assert session.query(Transaction).filter_by(account_id=account_id).count() == 0


def test_delete_last_manual_account_also_deletes_its_credential(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post("/api/account", json={"credential_id": credential_id, "name": "Wallet"}).json()["id"]

    response = http_client.delete(f"/api/account/{account_id}")

    assert response.status_code == 204
    with session_factory() as session:
        assert session.get(entity=Account, ident=account_id) is None
        assert session.get(entity=Credential, ident=credential_id) is None


def test_delete_one_of_many_manual_accounts_leaves_credential_intact(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    first_account_id = http_client.post("/api/account", json={"credential_id": credential_id, "name": "Wallet"}).json()[
        "id"
    ]
    http_client.post("/api/account", json={"credential_id": credential_id, "name": "Cash"})

    response = http_client.delete(f"/api/account/{first_account_id}")

    assert response.status_code == 204
    with session_factory() as session:
        assert session.get(entity=Account, ident=first_account_id) is None
        assert session.get(entity=Credential, ident=credential_id) is not None


def test_delete_account_rejects_non_manual_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    ing_credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=ing_credential_id)

    response = http_client.delete(f"/api/account/{account_id}")

    assert response.status_code == 403
    with session_factory() as session:
        assert session.get(entity=Account, ident=account_id) is not None


def test_update_account_balance_accepted_for_manual_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0},
    ).json()["id"]

    response = http_client.patch(f"/api/account/{account_id}", json={"balance": 555.55})

    assert response.status_code == 200
    assert response.json()["balance"] == 555.55
    with session_factory() as session:
        assert session.get(entity=Account, ident=account_id).balance == 555.55


def test_update_account_balance_rejected_for_non_manual_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    ing_credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=ing_credential_id)

    response = http_client.patch(f"/api/account/{account_id}", json={"balance": 999.0})

    assert response.status_code == 403


def test_update_transaction_amount_shifts_manual_account_balance(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0},
    ).json()["id"]
    transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions",
        json={"amount": -10.0, "date": "2026-05-20"},
    ).json()[
        "id"
    ]  # balance is now 90

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}",
        json={"amount": -25.0, "purpose": "actually pricier"},
    )

    assert response.status_code == 200
    assert response.json()["amount"] == -25.0
    with session_factory() as session:
        assert session.get(entity=Account, ident=account_id).balance == 75.0


def test_update_transaction_rejects_financial_fields_for_non_manual_account(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}",
        json={"amount": 999.0},
    )

    assert response.status_code == 403


def test_create_transaction_rejects_future_date(http_client: TestClient):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account", json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0}
    ).json()["id"]
    future = (date.today() + timedelta(days=14)).isoformat()

    response = http_client.post(
        f"/api/account/{account_id}/transactions",
        json={"amount": 10.0, "date": future},
    )

    assert response.status_code == 422
    assert "future" in response.json()["detail"].lower()


def test_update_transaction_rejects_future_date(http_client: TestClient):
    register(http_client)
    credential_id = _create_manual_credential(http_client)
    account_id = http_client.post(
        "/api/account", json={"credential_id": credential_id, "name": "Wallet", "balance": 100.0}
    ).json()["id"]
    transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions",
        json={"amount": 10.0, "date": date.today().isoformat()},
    ).json()["id"]
    future = (date.today() + timedelta(days=14)).isoformat()

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}",
        json={"date": future},
    )

    assert response.status_code == 422


def test_update_transaction_still_accepts_note_on_non_manual_account(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}",
        json={"note": "Still works"},
    )

    assert response.status_code == 200
    assert response.json()["note"] == "Still works"


def test_transaction_detail_read_defaults_counterpart_to_none():
    schema = TransactionDetailRead(
        id=1,
        account_id=1,
        amount=-5.0,
        purpose=None,
        date=date(year=2026, month=5, day=10),
        other_party=None,
        transaction_type=None,
        category=TransactionCategory.UNKNOWN,
        note=None,
        transfer_counterpart_id=None,
        pending=False,
    )

    assert schema.transfer_counterpart is None


def test_get_transaction_includes_transfer_counterpart(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_a = persist_account(session_factory=session_factory, credential_id=credential_id)
    account_b = persist_account(session_factory=session_factory, credential_id=credential_id)
    with session_factory() as session:
        out_transaction = Transaction(account_id=account_a, amount=-50.0, date=date(year=2026, month=5, day=10))
        in_transaction = Transaction(account_id=account_b, amount=50.0, date=date(year=2026, month=5, day=10))
        session.add_all([out_transaction, in_transaction])
        session.flush()
        out_transaction.transfer_counterpart_id = in_transaction.id
        in_transaction.transfer_counterpart_id = out_transaction.id
        session.commit()
        out_id, in_id = out_transaction.id, in_transaction.id

    response = http_client.get(f"/api/account/{account_a}/transactions/{out_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["transfer_counterpart_id"] == in_id
    assert body["transfer_counterpart"]["id"] == in_id
    assert body["transfer_counterpart"]["account_id"] == account_b
    assert "transfer_counterpart" not in body["transfer_counterpart"]


def test_unlink_transfer_endpoint_clears_link(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_a = persist_account(session_factory=session_factory, credential_id=credential_id)
    account_b = persist_account(session_factory=session_factory, credential_id=credential_id)
    with session_factory() as session:
        out_transaction = Transaction(
            account_id=account_a,
            amount=-50.0,
            date=date(year=2026, month=5, day=10),
            transaction_type=TransactionType.TRANSFER_OUT,
            transfer_original_type=TransactionType.OUTGOING,
        )
        in_transaction = Transaction(
            account_id=account_b,
            amount=50.0,
            date=date(year=2026, month=5, day=10),
            transaction_type=TransactionType.TRANSFER_IN,
            transfer_original_type=TransactionType.INCOMING,
        )
        session.add_all([out_transaction, in_transaction])
        session.flush()
        out_transaction.transfer_counterpart_id = in_transaction.id
        in_transaction.transfer_counterpart_id = out_transaction.id
        session.commit()
        out_id = out_transaction.id

    response = http_client.delete(f"/api/account/{account_a}/transactions/{out_id}/transfer-link")
    assert response.status_code == 204

    detail = http_client.get(f"/api/account/{account_a}/transactions/{out_id}").json()
    assert detail["transfer_counterpart_id"] is None
    assert detail["transfer_counterpart"] is None
    assert detail["transaction_type"] == "OUTGOING"


def test_unlink_transfer_endpoint_404_for_foreign_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    response = http_client.delete(f"/api/account/{account_id}/transactions/{transaction_id}/transfer-link")
    assert response.status_code == 404


# --- recurring transactions ------------------------------------------------


def test_create_recurring_transaction_schedules_rule_without_booking(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={
            "amount": -50.0,
            "purpose": "Rent",
            "frequency": "MONTHLY",
            "day_of_month": 28,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["frequency"] == "MONTHLY"
    assert body["day_of_month"] == 28
    assert body["day_of_week"] is None
    assert body["next_run_date"] is not None
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 100.0  # nothing booked yet
        assert account.transactions == []


def test_create_recurring_transaction_with_immediate_booking_books_today(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={
            "amount": -50.0,
            "frequency": "MONTHLY",
            "day_of_month": 15,
            "book_immediately": True,
        },
    )

    assert response.status_code == 201
    with session_factory() as session:
        account = session.get(entity=Account, ident=account_id)
        assert account.balance == 50.0
        assert len(account.transactions) == 1
        assert account.transactions[0].date == date.today()


def test_create_recurring_transaction_rejects_non_manual_account(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    ing_credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=ing_credential_id)

    response = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": 10.0, "frequency": "WEEKLY", "day_of_week": 0},
    )

    assert response.status_code == 403


def test_create_recurring_transaction_requires_account_of_user(http_client: TestClient):
    register(http_client)

    response = http_client.post(
        "/api/account/999999/recurring-transactions",
        json={"amount": 10.0, "frequency": "WEEKLY", "day_of_week": 0},
    )

    assert response.status_code == 404


def test_create_recurring_transaction_rejects_monthly_without_day(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": -50.0, "frequency": "MONTHLY"},
    )

    assert response.status_code == 422


def test_create_recurring_transaction_rejects_weekly_without_day(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": -50.0, "frequency": "WEEKLY"},
    )

    assert response.status_code == 422


def test_list_recurring_transactions_returns_rules(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)
    http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": -50.0, "frequency": "MONTHLY", "day_of_month": 1},
    )
    http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": 1000.0, "frequency": "WEEKLY", "day_of_week": 4},
    )

    response = http_client.get(f"/api/account/{account_id}/recurring-transactions")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert {rule["frequency"] for rule in body} == {"MONTHLY", "WEEKLY"}


def test_update_recurring_transaction_changes_schedule(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)
    rule_id = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": -50.0, "frequency": "MONTHLY", "day_of_month": 1},
    ).json()["id"]

    response = http_client.patch(
        f"/api/account/{account_id}/recurring-transactions/{rule_id}",
        json={"amount": -75.0, "frequency": "WEEKLY", "day_of_week": 3},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["amount"] == -75.0
    assert body["frequency"] == "WEEKLY"
    assert body["day_of_week"] == 3
    assert body["day_of_month"] is None


def test_update_recurring_transaction_unknown_returns_404(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.patch(
        f"/api/account/{account_id}/recurring-transactions/999999",
        json={"amount": 1.0, "frequency": "WEEKLY", "day_of_week": 0},
    )

    assert response.status_code == 404


def test_delete_recurring_transaction_removes_rule(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)
    rule_id = http_client.post(
        f"/api/account/{account_id}/recurring-transactions",
        json={"amount": -50.0, "frequency": "MONTHLY", "day_of_month": 1},
    ).json()["id"]

    response = http_client.delete(f"/api/account/{account_id}/recurring-transactions/{rule_id}")

    assert response.status_code == 204
    assert http_client.get(f"/api/account/{account_id}/recurring-transactions").json() == []


def test_delete_unknown_recurring_transaction_returns_404(http_client: TestClient):
    register(http_client)
    account_id = setup_manual_account(http_client)

    response = http_client.delete(f"/api/account/{account_id}/recurring-transactions/999999")

    assert response.status_code == 404
