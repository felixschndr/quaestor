from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from source.backend.services import credential_service
from source.backend.services.credential_service import SyncResult, SyncStatus

from tests.backend.conftest import (
    BANK_PASSWORD,
    HTTP_SESSION_TOKEN,
    PHONE_NUMBER,
    PIN,
    SECOND_USER_NAME,
    create_credential,
    login_as,
    register,
)


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
        http_client, bank="trade_republic", credentials={"phone": PHONE_NUMBER, "pin": PIN}
    ).json()["id"]

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    body = response.json()
    assert {credential["id"] for credential in body} == {first_id, second_id}
    assert {credential["bank"] for credential in body} == {"ing", "trade_republic"}


def test_list_credentials_excludes_other_users_credentials(http_client: TestClient):
    register(http_client)
    alice_credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name=SECOND_USER_NAME)
    login_as(http_client, user_name=SECOND_USER_NAME)
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


def test_supported_banks_returns_bank_metadata(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/supported_banks")

    assert response.status_code == 200
    assert response.json() == [
        {
            "name": "ing",
            "required_fields": ["username", "password"],
            "icon": "/static/banks/ing.png",
            "bank_identifier": "50010517",
        },
        {
            "name": "dkb",
            "required_fields": ["username", "password"],
            "icon": "/static/banks/dkb.png",
            "bank_identifier": "12030000",
        },
        {
            "name": "dfs",
            "required_fields": ["username", "password", "customer"],
            "icon": "/static/banks/dfs.png",
        },
        {
            "name": "trade_republic",
            "required_fields": ["phone", "pin"],
            "icon": "/static/banks/trade_republic.png",
            "note": "The phone number has to be in the format +491234567890 "
            "(with '+' and country code and no spaces).",
        },
        {
            "name": "manual",
            "required_fields": [],
            "icon": "/static/banks/manual.png",
            "note": "A manual account: balance and transactions are entered by hand.",
        },
    ]


def test_supported_banks_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/credentials/supported_banks").status_code == 401


def test_bank_icons_are_served_as_static_files(http_client: TestClient):
    for bank in ["ing", "dkb", "dfs", "trade_republic"]:
        response = http_client.get(f"/static/banks/{bank}.png")
        assert response.status_code == 200, bank
        assert response.headers["content-type"] == "image/png"
        assert len(response.content) > 0


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
        f"/api/credentials/{credential_id}/sync/2fa", json={"challenge_token": HTTP_SESSION_TOKEN, "code": PIN}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_sync_2fa_returns_404_for_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    response = http_client.post(
        f"/api/credentials/{credential_id}/sync/2fa", json={"challenge_token": HTTP_SESSION_TOKEN, "code": PIN}
    )

    assert response.status_code == 404
