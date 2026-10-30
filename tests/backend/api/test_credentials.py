import time
from collections.abc import Iterator
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from source.backend.services.banking import credential_service, sync_jobs
from source.backend.services.banking.credential_service import SyncResult, SyncStatus
from tests.backend.conftest import (
    BANK_PASSWORD,
    BANK_USERNAME,
    CHALLENGE_TOKEN,
    INTRUDER_USER_NAME,
    PHONE_NUMBER,
    PIN,
    SECOND_USER_NAME,
    TWO_FACTOR_CODE,
    assert_log_contains,
    create_credential,
    create_manual_credential,
    register,
    register_and_login,
)


@pytest.fixture(autouse=True)
def _reset_sync_jobs() -> Iterator[None]:
    sync_jobs._jobs.clear()
    yield
    sync_jobs._jobs.clear()


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
    assert not body["requires_two_factor_authentication"]


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


def test_get_credential_returns_own_credential(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.get(f"/api/credentials/{credential_id}")

    assert response.status_code == 200
    assert response.json()["id"] == credential_id


def test_update_credential_changes_credentials(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.patch(
        f"/api/credentials/{credential_id}",
        json={"credentials": {"username": "renamed", "password": BANK_PASSWORD}},
    )

    assert response.status_code == 200
    assert response.json()["id"] == credential_id
    # The secret credentials column is excluded from the update description, so nothing is reported as changed
    assert_log_contains(caplog, message=f"No changes to Credential <Credential(id={credential_id}")
    assert_log_contains(caplog=caplog, messages=["renamed", BANK_PASSWORD], negate=True)


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


def test_start_sync_returns_a_running_job(http_client: TestClient, completed_sync: MagicMock):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.post(f"/api/credentials/{credential_id}/sync")

    assert response.status_code == 202
    body = response.json()
    assert body["job_id"]
    assert body["status"] in {"running", "completed"}  # job may have finished before response is read
    assert body["credential_id"] == credential_id


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


def test_start_sync_is_refused_for_a_manual_credential(http_client: TestClient):
    register(http_client)
    credential_id = create_manual_credential(http_client)

    response = http_client.post(f"/api/credentials/{credential_id}/sync")

    assert response.status_code == 403
    credential = next(c for c in http_client.get("/api/auth/me").json()["credentials"] if c["id"] == credential_id)
    assert credential["last_successful_sync_timestamp"] is None


def test_start_sync_returns_404_for_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

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

    response = http_client.post(f"/api/credentials/{credential_id}/sync/{job_id}/2fa", json={"code": TWO_FACTOR_CODE})

    assert response.status_code == 202
    assert response.json()["status"] in {"confirming_2fa", "running", "completed"}
    _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="completed")


@pytest.mark.parametrize(
    argnames=("method", "path", "json"),
    argvalues=[
        ("GET", "", None),
        ("DELETE", "", None),
        ("POST", "/2fa", {"code": TWO_FACTOR_CODE}),
    ],
)
def test_unknown_sync_job_returns_404(http_client: TestClient, method: str, path: str, json: dict | None):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.request(
        method=method, url=f"/api/credentials/{credential_id}/sync/nonexistent{path}", json=json
    )

    assert response.status_code == 404


def test_submit_two_factor_returns_422_when_job_not_awaiting_two_factor(
    http_client: TestClient, completed_sync: MagicMock
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]
    _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="completed")

    response = http_client.post(f"/api/credentials/{credential_id}/sync/{job_id}/2fa", json={"code": TWO_FACTOR_CODE})

    assert response.status_code == 422


@pytest.mark.parametrize(argnames="method", argvalues=["GET", "DELETE"])
def test_sync_job_of_other_users_credential_returns_404(
    http_client: TestClient, completed_sync: MagicMock, caplog: pytest.LogCaptureFixture, method: str
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

    assert http_client.request(method=method, url=f"/api/credentials/{credential_id}/sync/{job_id}").status_code == 404
    assert_log_contains(caplog, message=f"attempted to sync <Credential(id={credential_id}")


def test_list_sync_jobs_returns_only_own_jobs(http_client: TestClient, completed_sync: MagicMock):
    register(http_client)
    owner_credential_id = create_credential(http_client).json()["id"]
    owner_job_id = http_client.post(f"/api/credentials/{owner_credential_id}/sync").json()["job_id"]

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)
    intruder_credential_id = create_credential(http_client).json()["id"]
    http_client.post(f"/api/credentials/{intruder_credential_id}/sync")

    jobs = http_client.get("/api/credentials/sync").json()
    assert [job["job_id"] for job in jobs] == [] or all(job["credential_id"] == intruder_credential_id for job in jobs)
    assert owner_job_id not in {job["job_id"] for job in jobs}


def test_cancel_sync_job_returns_204(http_client: TestClient, completed_sync: MagicMock):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    assert http_client.delete(f"/api/credentials/{credential_id}/sync/{job_id}").status_code == 204


def test_sync_job_eventually_completes(http_client: TestClient, completed_sync: MagicMock):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]

    last = _wait_for_status(http_client=http_client, credential_id=credential_id, job_id=job_id, expected="completed")
    assert last["error"] is None
    assert "challenge_token" not in last
    assert last["job_id"] == job_id
    assert last["credential_id"] == credential_id
