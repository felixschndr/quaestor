import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    INTRUDER_USER_NAME,
    RECENT_DATE,
    SECOND_DISPLAY_NAME,
    SECOND_USER_NAME,
    TRANSACTION_NOTE,
    UNKNOWN_ID,
    VALID_PASSWORD,
    assert_log_contains,
    create_credential,
    login_as,
    persist_account,
    persist_transaction,
    register,
    register_and_login,
    setup_manual_account,
)

BULK_URL = "/api/transactions/bulk"


def _manual_transactions(http_client: TestClient, count: int = 2) -> tuple[int, list[int]]:
    account_id = setup_manual_account(http_client)
    transaction_ids = [
        http_client.post(
            f"/api/account/{account_id}/transactions", json={"amount": -DEFAULT_AMOUNT, "date": str(RECENT_DATE)}
        ).json()["id"]
        for _ in range(count)
    ]
    return account_id, transaction_ids


def _bank_transaction(http_client: TestClient, session_factory: sessionmaker) -> tuple[int, int]:
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory, credential_id=credential_id)
    return account_id, persist_transaction(session_factory, account_id=account_id)


def _transaction(http_client: TestClient, transaction_id: int) -> dict:
    return http_client.get(f"/api/transactions/{transaction_id}").json()


def _contract(http_client: TestClient, account_id: int) -> int:
    return http_client.post("/api/contracts", json={"name": SECOND_DISPLAY_NAME, "account_id": account_id}).json()["id"]


def test_bulk_update_changes_category_note_and_type_of_all_transactions(
    http_client: TestClient, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    _, transaction_ids = _manual_transactions(http_client)

    response = http_client.patch(
        BULK_URL,
        json={
            "transaction_ids": transaction_ids,
            "category": TransactionCategory.BANK_FEES.value,
            "note": TRANSACTION_NOTE,
            "transaction_type": TransactionType.TRANSFER_OUT.value,
        },
    )

    assert response.status_code == 204
    for transaction_id in transaction_ids:
        transaction = _transaction(http_client=http_client, transaction_id=transaction_id)
        assert transaction["category"] == TransactionCategory.BANK_FEES.value
        assert transaction["category_source"] == "MANUAL"
        assert transaction["note"] == TRANSACTION_NOTE
        assert transaction["transaction_type"] == TransactionType.TRANSFER_OUT.value
    assert_log_contains(
        caplog,
        messages=[
            *(f"→ <Transaction(id={transaction_id}, " for transaction_id in transaction_ids),
            f"note: None → {TRANSACTION_NOTE}",
            "Bulk-updated 2 transaction(s) of <User(id=1",
        ],
    )


def test_bulk_update_assigns_and_removes_a_contract(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    account_id, transaction_ids = _manual_transactions(http_client)
    contract_id = _contract(http_client, account_id=account_id)

    assigned = http_client.patch(BULK_URL, json={"transaction_ids": transaction_ids, "contract_id": contract_id})

    assert assigned.status_code == 204
    members = http_client.get(f"/api/contracts/{contract_id}").json()["members"]
    assert sorted(member["id"] for member in members) == sorted(transaction_ids)

    removed = http_client.patch(BULK_URL, json={"transaction_ids": transaction_ids, "contract_id": None})

    assert removed.status_code == 204
    assert http_client.get(f"/api/contracts/{contract_id}").json()["members"] == []
    assert all(
        _transaction(http_client=http_client, transaction_id=transaction_id)["contract_id"] is None
        for transaction_id in transaction_ids
    )
    assert_log_contains(
        caplog,
        messages=[
            *(f"Assigned <Transaction(id={transaction_id}, " for transaction_id in transaction_ids),
            *(f"Removed <Transaction(id={transaction_id}, " for transaction_id in transaction_ids),
        ],
    )


def test_bulk_update_changes_nothing_when_one_transaction_cannot_be_changed(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    _, manual_transaction_ids = _manual_transactions(http_client)
    _, bank_transaction_id = _bank_transaction(http_client, session_factory=session_factory)

    response = http_client.patch(
        BULK_URL,
        json={
            "transaction_ids": [*manual_transaction_ids, bank_transaction_id],
            "note": TRANSACTION_NOTE,
            "transaction_type": TransactionType.TRANSFER_OUT.value,
        },
    )

    assert response.status_code == 403
    for transaction_id in [*manual_transaction_ids, bank_transaction_id]:
        assert _transaction(http_client=http_client, transaction_id=transaction_id)["note"] is None
    assert_log_contains(
        caplog, messages=["Bulk update of 3 transaction(s) of <User(id=1, ", "failed; rolled back all changes"]
    )
    assert_log_contains(caplog, message="Bulk-updated", negate=True)


def test_bulk_update_rejects_transactions_outside_the_contract_account(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    account_id, transaction_ids = _manual_transactions(http_client)
    _, other_account_transaction_id = _bank_transaction(http_client, session_factory=session_factory)
    contract_id = _contract(http_client, account_id=account_id)

    response = http_client.patch(
        BULK_URL, json={"transaction_ids": [*transaction_ids, other_account_transaction_id], "contract_id": contract_id}
    )

    assert response.status_code == 422
    assert "1 transaction(s) don't belong to the account" in response.json()["detail"]
    assert http_client.get(f"/api/contracts/{contract_id}").json()["members"] == []
    assert_log_contains(
        caplog,
        message=f"ValidationError on [PATCH] [{BULK_URL}] -> 422: 1 transaction(s) don't belong to the account of "
        f"<Contract(id={contract_id}, ",
    )


def test_bulk_update_rejects_pending_transactions(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory, credential_id=credential_id)
    pending_id = persist_transaction(session_factory, account_id=account_id, pending=True)

    response = http_client.patch(BULK_URL, json={"transaction_ids": [pending_id], "note": TRANSACTION_NOTE})

    assert response.status_code == 422
    assert "is pending and cannot be edited" in response.json()["detail"]
    assert_log_contains(
        caplog, message=f"ValidationError on [PATCH] [{BULK_URL}] -> 422: <Transaction(id={pending_id}, "
    )


def test_bulk_update_hides_transactions_of_other_users(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    register_and_login(http_client, user_name=INTRUDER_USER_NAME)
    _, foreign_transaction_ids = _manual_transactions(http_client, count=1)
    register_and_login(http_client)

    for transaction_ids in (foreign_transaction_ids, [UNKNOWN_ID]):
        response = http_client.patch(BULK_URL, json={"transaction_ids": transaction_ids, "note": TRANSACTION_NOTE})
        assert response.status_code == 404
    assert_log_contains(
        caplog,
        messages=[
            f"attempted to access <Transaction(id={foreign_transaction_ids[0]}, ",
            f"Transaction with the ID {UNKNOWN_ID} not found",
        ],
    )


@pytest.mark.parametrize(
    argnames=("permission", "payload", "expected_status", "expected_log"),
    argvalues=[
        ("write", {"note": TRANSACTION_NOTE, "category": TransactionCategory.BANK_FEES.value}, 204, "Bulk-updated 2"),
        ("write", {"transaction_type": TransactionType.TRANSFER_OUT.value}, 403, "A shared account only allows"),
        ("write", {"contract_id": None}, 403, "A shared account only allows"),
        ("read", {"note": TRANSACTION_NOTE}, 403, "only has read access to <Account(id="),
    ],
)
def test_bulk_update_on_a_shared_account_allows_only_category_and_note(
    http_client: TestClient,
    permission: str,
    payload: dict,
    expected_status: int,
    expected_log: str,
    caplog: pytest.LogCaptureFixture,
):
    recipient_id = register(http_client, user_name=SECOND_USER_NAME, display_name=SECOND_DISPLAY_NAME).json()["id"]
    register_and_login(http_client)
    account_id, transaction_ids = _manual_transactions(http_client)
    share_id = http_client.post(
        f"/api/account_shares/account/{account_id}", json={"user_id": recipient_id, "permission": permission}
    ).json()["id"]
    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    http_client.post(f"/api/account_shares/{share_id}/accept")

    response = http_client.patch(BULK_URL, json={"transaction_ids": transaction_ids, **payload})

    assert response.status_code == expected_status
    assert_log_contains(caplog, message=expected_log)


@pytest.mark.parametrize(
    argnames=("payload", "expected_log"),
    argvalues=[
        ({"transaction_ids": [UNKNOWN_ID]}, "Set at least one field to change"),
        ({"transaction_ids": [], "note": TRANSACTION_NOTE}, "'loc': ('body', 'transaction_ids')"),
    ],
)
def test_bulk_update_needs_transactions_and_something_to_change(
    http_client: TestClient, payload: dict, expected_log: str, caplog: pytest.LogCaptureFixture
):
    register(http_client)

    assert http_client.patch(BULK_URL, json=payload).status_code == 422
    assert_log_contains(caplog, messages=[f"RequestValidationError on [PATCH] [{BULK_URL}] -> 422: ", expected_log])
