from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from source.backend.services import credential_service
from source.backend.services.credential_service import SyncResult, SyncStatus

from tests.backend.conftest import BANK_PASSWORD, create_credential, login_as, register


def test_create_credential_returns_created_credential(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["bank"] == "ing"
    assert body["accounts"] == []
    assert body["requires_two_factor_authentication"] is False


def test_list_credentials_returns_empty_when_none_exist(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    assert response.json() == []


def test_list_credentials_returns_own_credentials(http_client: TestClient):
    register(http_client)
    first_id = create_credential(http_client).json()["id"]
    second_id = create_credential(
        http_client, bank="trade_republic", credentials={"phone": "+49", "pin": "1234"}
    ).json()["id"]

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    body = response.json()
    assert {credential["id"] for credential in body} == {first_id, second_id}
    assert {credential["bank"] for credential in body} == {"ing", "trade_republic"}


def test_list_credentials_excludes_other_users_credentials(http_client: TestClient):
    register(http_client)
    alice_credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="bob")
    login_as(http_client, user_name="bob")
    bob_credential_id = create_credential(http_client).json()["id"]

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    ids = {credential["id"] for credential in response.json()}
    assert ids == {bob_credential_id}
    assert alice_credential_id not in ids


def test_list_credentials_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/credentials").status_code == 401


def test_get_credential_returns_own_credential(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.get(f"/api/credentials/{credential_id}")

    assert response.status_code == 200
    assert response.json()["id"] == credential_id


def test_update_credential_changes_credentials(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.patch(
        f"/api/credentials/{credential_id}",
        json={"credentials": {"username": "renamed", "password": BANK_PASSWORD}},
    )

    assert response.status_code == 200
    assert response.json()["id"] == credential_id


def test_delete_credential_removes_it(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    delete_response = http_client.delete(f"/api/credentials/{credential_id}")

    assert delete_response.status_code == 204
    assert http_client.get(f"/api/credentials/{credential_id}").status_code == 404


def test_get_unknown_credential_returns_not_found(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/999")

    assert response.status_code == 404


def test_list_all_possible_includes_supported_banks(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/list_all_possible")

    assert response.status_code == 200
    assert {"ing", "dkb", "dfs", "trade_republic"} == {bank["Bank Name"] for bank in response.json()}


def test_list_all_possible_only_includes_non_null_fields(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/list_all_possible")

    assert response.status_code == 200
    assert response.json() == [
        {
            "Bank Name": "ing",
            "Required Fields": ["username", "password"],
            "Bank Identifier": "50010517",
        },
        {
            "Bank Name": "dkb",
            "Required Fields": ["username", "password"],
            "Bank Identifier": "12030000",
        },
        {
            "Bank Name": "dfs",
            "Required Fields": ["username", "password", "customer"],
        },
        {
            "Bank Name": "trade_republic",
            "Required Fields": ["phone", "pin"],
            "Note": "The phone number has to be in the format +491234567890 "
            "(with '+' and country code and no spaces).",
        },
    ]


def test_create_credential_rejects_unknown_bank(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client, bank="not_a_bank")

    assert response.status_code == 422


def test_create_credential_for_dfs_requires_extra_fields(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client, bank="dfs")

    assert response.status_code == 422


def test_sync_credential_returns_completed(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )

    response = http_client.post(f"/api/credentials/{credential_id}/sync")

    assert response.status_code == 200
    assert response.json() == {"status": "completed", "challenge_token": None, "expires_at": None}  # nosec B105


def test_sync_credential_returns_202_and_challenge_when_two_factor_required(
    http_client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    expires_at = datetime(year=2026, month=6, day=1, hour=12)
    monkeypatch.setattr(
        target=credential_service,
        name="sync_credential",
        value=lambda **_: SyncResult(
            status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token="tok", expires_at=expires_at
        ),  # nosec B106
    )

    response = http_client.post(f"/api/credentials/{credential_id}/sync")

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "2fa_required"
    assert body["challenge_token"] == "tok"


def test_sync_credential_returns_404_for_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.post(f"/api/credentials/{credential_id}/sync").status_code == 404


def test_sync_2fa_completes_login(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="confirm_two_factor", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )

    response = http_client.post(
        f"/api/credentials/{credential_id}/sync/2fa",
        json={"challenge_token": "tok", "code": "1234"},  # nosec B105
    )

    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_sync_2fa_returns_404_for_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    response = http_client.post(
        f"/api/credentials/{credential_id}/sync/2fa",
        json={"challenge_token": "tok", "code": "1234"},  # nosec B105
    )

    assert response.status_code == 404
