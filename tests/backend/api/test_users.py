from fastapi.testclient import TestClient

from tests.backend.conftest import create_credential, login_as, register


def test_list_users_returns_only_the_current_user(http_client: TestClient):
    register(http_client, user_name="alice")
    register(http_client, user_name="bob")
    login_as(http_client, user_name="bob")

    response = http_client.get("/users")

    assert response.status_code == 200
    assert [user["user_name"] for user in response.json()] == ["bob"]


def test_get_own_user_includes_credentials_and_balance(http_client: TestClient):
    user_id = register(http_client, user_name="alice").json()["id"]
    create_credential(http_client)

    response = http_client.get(f"/users/{user_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == 0.0
    assert [credential["bank"] for credential in body["credentials"]] == ["ing"]


def test_update_user_changes_display_name(http_client: TestClient):
    user_id = register(http_client, user_name="alice").json()["id"]

    response = http_client.patch(f"/users/{user_id}", json={"display_name": "Renamed"})

    assert response.status_code == 200
    assert response.json()["display_name"] == "Renamed"


def test_delete_user_removes_account_and_invalidates_session(http_client: TestClient):
    user_id = register(http_client, user_name="alice").json()["id"]

    delete_response = http_client.delete(f"/users/{user_id}")

    assert delete_response.status_code == 204
    assert http_client.get("/users").status_code == 401


def test_sync_without_credentials_returns_no_content(http_client: TestClient):
    register(http_client, user_name="alice")

    response = http_client.post("/users/sync")

    assert response.status_code == 204
