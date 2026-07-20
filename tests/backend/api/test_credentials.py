import time
from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from source.backend.services.banking import credential_service, sync_jobs
from source.backend.services.banking.credential_service import SyncResult, SyncStatus
from source.backend.services.banking.sync_jobs import JobStatus
from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    CHALLENGE_TOKEN,
    PHONE_NUMBER,
    PIN,
    SECOND_USER_NAME,
    create_credential,
    register,
    register_and_login,
)


@pytest.fixture(autouse=True)
def _reset_sync_jobs() -> Iterator[None]:
    sync_jobs._jobs.clear()
    sync_jobs._subscribers.clear()
    yield
    sync_jobs._jobs.clear()
    sync_jobs._subscribers.clear()


def _wait_for_status(
    http_client: TestClient,
    credential_id: int,
    job_id: str,
    expected: str,
    timeout: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = http_client.get(f"/api/credentials/{credential_id}/sync/{job_id}")
        if response.status_code == 200:
            last = response.json()
            if last["status"] == expected:
                return last
        time.sleep(0.02)
    raise AssertionError(f"Job {job_id} did not reach {expected!r}; last={last}")


def test_create_credential_returns_created_credential(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["bank"] == "fints"
    assert body["bank_name"]
    assert body["bank_icon"] == "/static/banks/ing-diba.png"
    assert body["accounts"] == []
    assert body["requires_two_factor_authentication"] is False


def test_create_credential_rejects_duplicate_for_same_user(http_client: TestClient):
    register(http_client)
    first = create_credential(http_client)
    assert first.status_code == 201

    second = create_credential(http_client)

    assert second.status_code == 409
    assert "already" in second.json()["detail"].lower()


def test_create_credential_allows_multiple_manual_credentials(http_client: TestClient):
    register(http_client)
    first = create_credential(http_client, bank="manual", credentials={})
    assert first.status_code == 201

    second = create_credential(http_client, bank="manual", credentials={})

    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]


def test_create_credential_allows_same_bank_with_different_login(http_client: TestClient):
    register(http_client)
    first = create_credential(http_client)
    assert first.status_code == 201

    second = create_credential(
        http_client,
        credentials={"username": SECOND_USER_NAME, "password": BANK_PASSWORD, "blz": "50010517"},
    )

    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]


def test_create_credential_allows_same_login_for_different_user(http_client: TestClient):
    register(http_client)
    alice_credential = create_credential(http_client)
    assert alice_credential.status_code == 201

    register_and_login(http_client, user_name=SECOND_USER_NAME)
    bob_credential = create_credential(http_client)

    assert bob_credential.status_code == 201


def test_list_credentials_returns_empty_when_none_exist(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    assert response.json() == []


def test_list_credentials_returns_own_credentials(http_client: TestClient):
    register(http_client)
    first_credential_id = create_credential(http_client).json()["id"]
    second_credential_id = create_credential(
        http_client, bank="trade_republic", credentials={"phone": PHONE_NUMBER, "pin": PIN}
    ).json()["id"]

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    body = response.json()
    assert {credential["id"] for credential in body} == {first_credential_id, second_credential_id}
    assert {credential["bank"] for credential in body} == {"fints", "trade_republic"}


def test_list_credentials_excludes_other_users_credentials(http_client: TestClient):
    register(http_client)
    alice_credential_id = create_credential(http_client).json()["id"]

    register_and_login(http_client, user_name=SECOND_USER_NAME)
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


def test_list_supported_banks_returns_catalog(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/supported_banks")

    assert response.status_code == 200
    catalog = response.json()
    providers = {entry["provider"] for entry in catalog}
    assert {"fints", "dfs", "trade_republic", "manual"} <= providers
    sample = catalog[0]
    expected_keys = {
        "provider",
        "key",
        "name",
        "bic",
        "icon",
        "tested",
        "required_fields",
        "field_rules",
        "blzs",
        "countries",
    }
    assert expected_keys == sample.keys()
    fints_entry = next(entry for entry in catalog if entry["provider"] == "fints")
    assert expected_keys == fints_entry.keys()


def test_supported_banks_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/credentials/supported_banks").status_code == 401


def test_bank_icons_are_served_as_static_files(http_client: TestClient):
    response = http_client.get("/static/banks/ing-diba.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert len(response.content) > 0


def test_create_credential_rejects_unknown_bank(http_client: TestClient):
    register(http_client)

    response = http_client.post(
        "/api/credentials",
        json={"bank": "not_a_bank", "credentials": {"username": BANK_USERNAME, "password": BANK_PASSWORD}},
    )

    assert response.status_code == 422


def test_start_sync_returns_a_running_job(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )

    response = http_client.post(f"/api/credentials/{credential_id}/sync")

    assert response.status_code == 202
    body = response.json()
    assert body["job_id"]
    assert body["status"] in {"running", "completed"}  # job may have finished before response is read


def test_sync_job_eventually_completes(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    body = _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="completed")
    assert body["error"] is None


def test_sync_job_reports_failure_when_the_sync_raises(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    def _explode(**_: Any) -> SyncResult:
        raise RuntimeError("Something went wrong")

    monkeypatch.setattr(target=credential_service, name="sync_credential", value=_explode)

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    body = _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="failed")
    assert "Something went wrong" in (body["error"] or "")


def test_sync_job_transitions_to_awaiting_two_factor(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(
        http_client, bank="trade_republic", credentials={"phone": PHONE_NUMBER, "pin": PIN}
    ).json()["id"]
    expires_at = datetime(year=2026, month=6, day=1, hour=12)
    monkeypatch.setattr(
        target=credential_service,
        name="sync_credential",
        value=lambda **_: SyncResult(
            status=SyncStatus.TWO_FACTOR_REQUIRED,
            challenge_token=CHALLENGE_TOKEN,
            expires_at=expires_at,
            authorization_url="https://tilisy.enablebanking.com/ais/start?sessionid=abc",
        ),
    )

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    body = _wait_for_status(
        http_client=http_client, credential_id=credential_id, job_id=job_id, expected="awaiting_2fa"
    )
    assert body["expires_at"] is not None
    assert "challenge_token" not in body  # internal — must not leak to the client
    assert body["authorization_url"] == "https://tilisy.enablebanking.com/ais/start?sessionid=abc"


def test_start_sync_returns_404_for_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register_and_login(http_client, user_name="intruder")

    assert http_client.post(f"/api/credentials/{credential_id}/sync").status_code == 404


def test_submit_two_factor_completes_the_sync(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(
        http_client, bank="trade_republic", credentials={"phone": PHONE_NUMBER, "pin": PIN}
    ).json()["id"]
    monkeypatch.setattr(
        target=credential_service,
        name="sync_credential",
        value=lambda **_: SyncResult(status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN),
    )
    monkeypatch.setattr(
        target=credential_service,
        name="confirm_two_factor",
        value=lambda **_: SyncResult(status=SyncStatus.COMPLETED),
    )

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]
    _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="awaiting_2fa")

    response = http_client.post(f"/api/credentials/{credential_id}/sync/{job_id}/2fa", json={"code": "1234"})

    assert response.status_code == 202
    assert response.json()["status"] in {"running", "completed"}
    _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="completed")


def test_submit_two_factor_returns_404_for_unknown_job(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.post(f"/api/credentials/{credential_id}/sync/nonexistent/2fa", json={"code": "1234"})

    assert response.status_code == 404


def test_submit_two_factor_returns_422_when_job_not_awaiting_two_factor(
    http_client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]
    _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="completed")

    response = http_client.post(f"/api/credentials/{credential_id}/sync/{job_id}/2fa", json={"code": "1234"})

    assert response.status_code == 422


def test_get_sync_job_returns_404_for_other_users_credential(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    register_and_login(http_client, user_name="intruder")

    assert http_client.get(f"/api/credentials/{credential_id}/sync/{job_id}").status_code == 404


def test_sync_job_websocket_streams_terminal_state(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    with http_client.websocket_connect(f"/api/credentials/{credential_id}/sync/{job_id}/ws") as ws:
        last = None
        while True:
            message = ws.receive_json()
            last = message
            if message["status"] in {JobStatus.COMPLETED.value, JobStatus.FAILED.value}:
                break
    assert last is not None
    assert last["status"] == "completed"
    assert "challenge_token" not in last
    assert last["job_id"] == job_id
    assert last["credential_id"] == credential_id


def test_sync_job_websocket_ends_when_client_disconnects_while_job_pending(
    http_client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service,
        name="sync_credential",
        value=lambda **_: SyncResult(
            status=SyncStatus.TWO_FACTOR_REQUIRED, challenge_token=CHALLENGE_TOKEN, expires_at=datetime.max
        ),
    )
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    # Closing the socket while the job is still pending must end the handler (and drop its
    # subscription) instead of waiting for job updates forever — that hang blocked every
    # server shutdown/reload with an open sync WebSocket.
    with http_client.websocket_connect(f"/api/credentials/{credential_id}/sync/{job_id}/ws") as ws:
        while ws.receive_json()["status"] != JobStatus.AWAITING_TWO_FACTOR.value:
            pass

    for _ in range(100):
        if not sync_jobs._subscribers.get(job_id):
            break
        time.sleep(0.01)
    assert not sync_jobs._subscribers.get(job_id)


def test_sync_job_websocket_rejects_unauthenticated_clients(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    http_client.cookies.delete("session")
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with http_client.websocket_connect(f"/api/credentials/{credential_id}/sync/{job_id}/ws"):
            pass
    assert excinfo.value.code == 4401


def test_start_sync_includes_credential_id_in_response(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    monkeypatch.setattr(
        target=credential_service,
        name="sync_credential",
        value=lambda **_: SyncResult(status=SyncStatus.COMPLETED),
    )

    response = http_client.post(f"/api/credentials/{credential_id}/sync")

    assert response.status_code == 202
    assert response.json()["credential_id"] == credential_id
