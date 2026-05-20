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
