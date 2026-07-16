from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.logging_utils import NO_SESSION_LOG_LABEL
from source.backend.services.banking import credential_service
from source.backend.services.banking.credential_service import SyncResult, SyncStatus
from tests.backend.conftest import (
    NEW_VALID_PASSWORD,
    SECOND_USER_NAME,
    USER_NAME,
    VALID_PASSWORD,
    WRONG_PASSWORD,
    login_as,
    make_credential,
    register,
    register_and_get_id,
    register_and_login,
)


def test_update_user_changes_display_name(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"display_name": "Renamed"})

    assert response.status_code == 200
    assert response.json()["display_name"] == "Renamed"
    updated = next(record for record in caplog.records if "Updated User" in record.getMessage())
    assert updated.session not in (None, NO_SESSION_LOG_LABEL)


def test_update_user_changes_user_name(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"user_name": SECOND_USER_NAME})

    assert response.status_code == 200
    assert response.json()["user_name"] == SECOND_USER_NAME
    assert login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD).status_code == 200
    assert login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD).status_code == 401


def test_update_user_normalises_new_user_name(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"user_name": "  MixedCase  "})

    assert response.status_code == 200
    assert response.json()["user_name"] == "mixedcase"


def test_update_user_rejects_user_name_taken_by_other_user(http_client: TestClient):
    register(http_client, user_name=SECOND_USER_NAME)
    user_id = register_and_login(http_client, user_name=USER_NAME)

    response = http_client.patch(f"/api/users/{user_id}", json={"user_name": SECOND_USER_NAME})

    assert response.status_code == 409
    assert http_client.get("/api/auth/me").json()["user_name"] == USER_NAME


def test_update_user_rejects_user_name_taken_by_other_user_case_insensitively(http_client: TestClient):
    register(http_client, user_name=SECOND_USER_NAME)
    user_id = register_and_login(http_client, user_name=USER_NAME)

    response = http_client.patch(f"/api/users/{user_id}", json={"user_name": SECOND_USER_NAME})

    assert response.status_code == 409


def test_update_user_keeping_same_user_name_is_a_noop(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"user_name": USER_NAME})

    assert response.status_code == 200
    assert response.json()["user_name"] == USER_NAME


def test_update_user_rejects_empty_user_name(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"user_name": "   "})

    assert response.status_code == 422
    assert http_client.get("/api/auth/me").json()["user_name"] == USER_NAME


def test_update_user_changes_language(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"language": "de"})

    assert response.status_code == 200
    assert response.json()["language"] == "de"
    assert http_client.get("/api/auth/me").json()["language"] == "de"


def test_update_user_rejects_unsupported_language(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"language": "klingon"})

    assert response.status_code == 422
    assert http_client.get("/api/auth/me").json()["language"] == "en"


def test_update_user_changes_theme(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"theme": "DARK"})

    assert response.status_code == 200
    assert response.json()["theme"] == "DARK"
    assert http_client.get("/api/auth/me").json()["theme"] == "DARK"


def test_update_user_rejects_invalid_theme(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(f"/api/users/{user_id}", json={"theme": "neon"})

    assert response.status_code == 422
    assert http_client.get("/api/auth/me").json()["theme"] == "SYSTEM"


def test_update_user_changes_password_with_correct_current_password(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 200
    assert login_as(http_client, user_name=USER_NAME, password=NEW_VALID_PASSWORD).status_code == 200
    assert login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD).status_code == 401


def test_update_user_rejects_password_change_with_wrong_current_password(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": WRONG_PASSWORD, "new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 401
    assert login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD).status_code == 200


def test_update_user_rejects_new_password_without_current_password(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 422


def test_update_user_rejects_new_password_that_fails_complexity(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": "alllowercaseletters"},  # nosec B105
    )

    assert response.status_code == 422


def test_update_user_rejects_short_new_password(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": "Sh0rt!"},  # nosec B105
    )

    assert response.status_code == 422


def test_changing_password_revokes_all_other_sessions(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    # A second login leaves a stale session behind in the DB; the client now holds the newest one.
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})
    assert len(http_client.get(f"/api/users/{user_id}/sessions").json()) == 2

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 200
    remaining = http_client.get(f"/api/users/{user_id}/sessions").json()
    assert len(remaining) == 1
    assert remaining[0]["is_current"] is True


def test_updating_profile_without_password_keeps_other_sessions(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    response = http_client.patch(f"/api/users/{user_id}", json={"display_name": "Renamed"})

    assert response.status_code == 200
    assert len(http_client.get(f"/api/users/{user_id}/sessions").json()) == 2


def test_update_user_can_change_display_name_and_password_together(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={
            "display_name": "Renamed",
            "current_password": VALID_PASSWORD,
            "new_password": NEW_VALID_PASSWORD,
        },
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Renamed"
    assert login_as(http_client, user_name=USER_NAME, password=NEW_VALID_PASSWORD).status_code == 200


def test_delete_user_removes_account_and_invalidates_session(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    delete_response = http_client.delete(f"/api/users/{user_id}")

    assert delete_response.status_code == 204
    assert http_client.get("/api/auth/me").status_code == 401


def test_sync_without_credentials_returns_empty_list(http_client: TestClient):
    register(http_client)

    response = http_client.post("/api/users/sync")

    assert response.status_code == 202
    assert response.json() == []


def test_sync_starts_jobs_for_normal_and_2fa_credentials(
    http_client: TestClient,
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
):
    user_id = register_and_get_id(http_client)
    with session_factory() as session:
        normal = make_credential(session, user_id=user_id)
        two_factor = make_credential(
            session,
            user_id=user_id,
            bank=BankProvider.FINTS,
            requires_two_factor_authentication=True,
        )
        session.commit()
        normal_id = normal.id
        two_factor_id = two_factor.id

    sync_mock = MagicMock(return_value=SyncResult(status=SyncStatus.COMPLETED))
    monkeypatch.setattr(target=credential_service, name="sync_credential", value=sync_mock)

    response = http_client.post("/api/users/sync")

    assert response.status_code == 202
    body = response.json()
    returned_credential_ids = sorted(job["credential_id"] for job in body)
    assert returned_credential_ids == sorted([normal_id, two_factor_id])
    for job in body:
        assert job["job_id"]
        assert job["status"] in {"running", "completed"}


def test_sync_skips_credentials_with_sync_disabled(
    http_client: TestClient,
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
):
    user_id = register_and_get_id(http_client)
    with session_factory() as session:
        enabled = make_credential(session, user_id=user_id)
        make_credential(session, user_id=user_id, bank=BankProvider.FINTS, sync_enabled=False)
        session.commit()
        enabled_id = enabled.id

    sync_mock = MagicMock(return_value=SyncResult(status=SyncStatus.COMPLETED))
    monkeypatch.setattr(target=credential_service, name="sync_credential", value=sync_mock)

    response = http_client.post("/api/users/sync")

    assert response.status_code == 202
    body = response.json()
    assert [job["credential_id"] for job in body] == [enabled_id]


def test_list_user_sessions_returns_current_session_marked(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.get(f"/api/users/{user_id}/sessions")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["is_current"] is True
    assert body[0]["ip"] is not None
    assert body[0]["user_agent"] is not None


def test_list_user_sessions_captures_custom_user_agent(http_client: TestClient):
    http_client.headers["user-agent"] = "MyTestAgent/1.0"
    user_id = register_and_get_id(http_client)

    response = http_client.get(f"/api/users/{user_id}/sessions")

    assert response.status_code == 200
    assert response.json()[0]["user_agent"] == "MyTestAgent/1.0"


def test_list_user_sessions_returns_multiple_sessions_with_only_current_flagged(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    other_client_response = http_client.post(
        "/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD}
    )
    assert other_client_response.status_code == 200

    response = http_client.get(f"/api/users/{user_id}/sessions")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert sum(s["is_current"] for s in body) == 1


def test_list_user_sessions_for_other_user_returns_404(http_client: TestClient):
    first_user_id = register_and_get_id(http_client, user_name=USER_NAME)
    register_and_login(http_client, user_name="other")

    response = http_client.get(f"/api/users/{first_user_id}/sessions")

    assert response.status_code == 404


def test_list_user_sessions_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/users/1/sessions").status_code == 401


def test_last_used_at_is_bumped_on_authenticated_request(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    initial = http_client.get(f"/api/users/{user_id}/sessions").json()[0]["last_used_at"]

    http_client.get("/api/auth/me")
    bumped = http_client.get(f"/api/users/{user_id}/sessions").json()[0]["last_used_at"]

    assert bumped >= initial


def test_revoke_other_session_deletes_it(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})
    sessions = http_client.get(f"/api/users/{user_id}/sessions").json()
    other_session_id = next(s["id"] for s in sessions if not s["is_current"])

    response = http_client.delete(f"/api/users/{user_id}/sessions/{other_session_id}")

    assert response.status_code == 204
    remaining = http_client.get(f"/api/users/{user_id}/sessions").json()
    assert all(s["id"] != other_session_id for s in remaining)


def test_revoke_current_session_returns_422(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    current_session_id = http_client.get(f"/api/users/{user_id}/sessions").json()[0]["id"]

    response = http_client.delete(f"/api/users/{user_id}/sessions/{current_session_id}")

    assert response.status_code == 422
    assert http_client.get("/api/auth/me").status_code == 200


def test_revoke_unknown_session_returns_404(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.delete(f"/api/users/{user_id}/sessions/999999")

    assert response.status_code == 404


def test_revoke_other_users_session_returns_404(http_client: TestClient):
    first_user_id = register_and_get_id(http_client, user_name=USER_NAME)
    first_user_session_id = http_client.get(f"/api/users/{first_user_id}/sessions").json()[0]["id"]

    other_user_id = register_and_login(http_client, user_name="other")

    response = http_client.delete(f"/api/users/{other_user_id}/sessions/{first_user_session_id}")

    assert response.status_code == 404


def test_revoke_session_for_other_user_id_returns_404(http_client: TestClient):
    first_user_id = register_and_get_id(http_client, user_name=USER_NAME)
    register_and_login(http_client, user_name="other")

    response = http_client.delete(f"/api/users/{first_user_id}/sessions/1")

    assert response.status_code == 404


def test_revoke_session_requires_authentication(http_client: TestClient):
    assert http_client.delete("/api/users/1/sessions/1").status_code == 401


def test_revoke_all_other_sessions_keeps_only_current(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})
    assert len(http_client.get(f"/api/users/{user_id}/sessions").json()) == 3

    response = http_client.delete(f"/api/users/{user_id}/sessions")

    assert response.status_code == 204
    remaining = http_client.get(f"/api/users/{user_id}/sessions").json()
    assert len(remaining) == 1
    assert remaining[0]["is_current"] is True


def test_revoke_all_other_sessions_with_only_current_session_is_noop(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.delete(f"/api/users/{user_id}/sessions")

    assert response.status_code == 204
    assert http_client.get("/api/auth/me").status_code == 200


def test_revoke_all_other_sessions_for_other_user_returns_404(http_client: TestClient):
    first_user_id = register_and_get_id(http_client, user_name=USER_NAME)
    register_and_login(http_client, user_name="other")

    response = http_client.delete(f"/api/users/{first_user_id}/sessions")

    assert response.status_code == 404


def test_revoke_all_other_sessions_requires_authentication(http_client: TestClient):
    assert http_client.delete("/api/users/1/sessions").status_code == 401
