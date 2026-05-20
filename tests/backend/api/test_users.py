from fastapi.testclient import TestClient

from tests.backend.conftest import register


def test_update_user_changes_display_name(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    response = http_client.patch(f"/api/users/{user_id}", json={"display_name": "Renamed"})

    assert response.status_code == 200
    assert response.json()["display_name"] == "Renamed"


def test_delete_user_removes_account_and_invalidates_session(http_client: TestClient):
    user_id = register(http_client).json()["id"]

    delete_response = http_client.delete(f"/api/users/{user_id}")

    assert delete_response.status_code == 204
    assert http_client.get("/api/auth/me").status_code == 401


def test_sync_without_credentials_returns_no_content(http_client: TestClient):
    register(http_client)

    response = http_client.post("/api/users/sync")

    assert response.status_code == 204
