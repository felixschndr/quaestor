from fastapi.testclient import TestClient

from tests.backend.conftest import (
    NEW_VALID_PASSWORD,
    USER_NAME,
    VALID_PASSWORD,
    WRONG_PASSWORD,
    login_as,
    register,
)


def test_update_user_changes_display_name(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(f"/api/users/{user_id}", json={"display_name": "Renamed"})

    assert response.status_code == 200
    assert response.json()["display_name"] == "Renamed"


def test_update_user_changes_password_with_correct_current_password(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 200
    assert login_as(http_client, user_name=USER_NAME, password=NEW_VALID_PASSWORD).status_code == 200
    assert login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD).status_code == 401


def test_update_user_rejects_password_change_with_wrong_current_password(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": WRONG_PASSWORD, "new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 401
    assert login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD).status_code == 200


def test_update_user_rejects_new_password_without_current_password(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"new_password": NEW_VALID_PASSWORD},
    )

    assert response.status_code == 422


def test_update_user_rejects_new_password_that_fails_complexity(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": "alllowercaseletters"},  # nosec B105
    )

    assert response.status_code == 422


def test_update_user_rejects_short_new_password(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(
        f"/api/users/{user_id}",
        json={"current_password": VALID_PASSWORD, "new_password": "Sh0rt!"},  # nosec B105
    )

    assert response.status_code == 422


def test_update_user_can_change_display_name_and_password_together(http_client: TestClient):
    user_id = register(http_client).json()["id"]

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
    user_id = register(http_client).json()["id"]

    delete_response = http_client.delete(f"/api/users/{user_id}")

    assert delete_response.status_code == 204
    assert http_client.get("/api/auth/me").status_code == 401


def test_sync_without_credentials_returns_no_content(http_client: TestClient):
    register(http_client)

    response = http_client.post("/api/users/sync")

    assert response.status_code == 204


def test_list_user_sessions_returns_current_session_marked(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.get(f"/api/users/{user_id}/sessions")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["is_current"] is True
    assert body[0]["ip"] is not None
    assert body[0]["user_agent"] is not None


def test_list_user_sessions_captures_custom_user_agent(http_client: TestClient):
    http_client.headers["user-agent"] = "MyTestAgent/1.0"
    user_id = register(http_client).json()["id"]

    response = http_client.get(f"/api/users/{user_id}/sessions")

    assert response.status_code == 200
    assert response.json()[0]["user_agent"] == "MyTestAgent/1.0"


def test_list_user_sessions_returns_multiple_sessions_with_only_current_flagged(http_client: TestClient):
    user_id = register(http_client).json()["id"]
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
    admin_id = register(http_client, user_name="admin").json()["id"]
    register(http_client, user_name="other")
    login_as(http_client, user_name="other")

    response = http_client.get(f"/api/users/{admin_id}/sessions")

    assert response.status_code == 404


def test_list_user_sessions_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/users/1/sessions").status_code == 401


def test_last_used_at_is_bumped_on_authenticated_request(http_client: TestClient):
    user_id = register(http_client).json()["id"]
    initial = http_client.get(f"/api/users/{user_id}/sessions").json()[0]["last_used_at"]

    http_client.get("/api/auth/me")
    bumped = http_client.get(f"/api/users/{user_id}/sessions").json()[0]["last_used_at"]

    assert bumped >= initial


def test_revoke_other_session_deletes_it(http_client: TestClient):
    user_id = register(http_client).json()["id"]
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})
    sessions = http_client.get(f"/api/users/{user_id}/sessions").json()
    other_session_id = next(s["id"] for s in sessions if not s["is_current"])

    response = http_client.delete(f"/api/users/{user_id}/sessions/{other_session_id}")

    assert response.status_code == 204
    remaining = http_client.get(f"/api/users/{user_id}/sessions").json()
    assert [s["id"] for s in remaining] != [other_session_id]
    assert all(s["id"] != other_session_id for s in remaining)


def test_revoke_current_session_returns_422(http_client: TestClient):
    user_id = register(http_client).json()["id"]
    current_session_id = http_client.get(f"/api/users/{user_id}/sessions").json()[0]["id"]

    response = http_client.delete(f"/api/users/{user_id}/sessions/{current_session_id}")

    assert response.status_code == 422
    assert http_client.get("/api/auth/me").status_code == 200


def test_revoke_unknown_session_returns_404(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.delete(f"/api/users/{user_id}/sessions/999999")

    assert response.status_code == 404


def test_revoke_other_users_session_returns_404(http_client: TestClient):
    admin_id = register(http_client, user_name="admin").json()["id"]
    admin_session_id = http_client.get(f"/api/users/{admin_id}/sessions").json()[0]["id"]

    register(http_client, user_name="other")
    other_user_id = login_as(http_client, user_name="other").json()["id"]

    response = http_client.delete(f"/api/users/{other_user_id}/sessions/{admin_session_id}")

    assert response.status_code == 404


def test_revoke_session_for_other_user_id_returns_404(http_client: TestClient):
    admin_id = register(http_client, user_name="admin").json()["id"]
    register(http_client, user_name="other")
    login_as(http_client, user_name="other")

    response = http_client.delete(f"/api/users/{admin_id}/sessions/1")

    assert response.status_code == 404


def test_revoke_session_requires_authentication(http_client: TestClient):
    assert http_client.delete("/api/users/1/sessions/1").status_code == 401
