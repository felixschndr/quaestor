from fastapi.testclient import TestClient

from tests.backend.conftest import USER_NAME, create_credential, login_as, register


def test_credential_endpoints_require_authentication(http_client: TestClient):
    http_client.cookies.clear()

    assert http_client.get("/api/credentials/1").status_code == 401
    assert http_client.post("/api/credentials", json={}).status_code == 401


def test_user_endpoints_require_authentication(http_client: TestClient):
    http_client.cookies.clear()

    assert http_client.get("/api/auth/me").status_code == 401


def test_user_cannot_read_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    login_as(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.get(f"/api/credentials/{credential_id}").status_code == 404


def test_user_cannot_modify_or_delete_other_users_credential(http_client: TestClient):
    register(http_client, user_name="owner")
    login_as(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.patch(f"/api/credentials/{credential_id}", json={"username": "x"}).status_code == 404
    assert http_client.delete(f"/api/credentials/{credential_id}").status_code == 404


def test_user_cannot_delete_other_users_account(http_client: TestClient):
    first_user_id = register(http_client, user_name=USER_NAME).json()["id"]
    register(http_client, user_name="other")
    login_as(http_client, user_name="other")

    response = http_client.delete(f"/api/users/{first_user_id}")

    assert response.status_code == 404


def test_user_cannot_patch_other_users_account(http_client: TestClient):
    first_user_id = register(http_client, user_name=USER_NAME).json()["id"]
    register(http_client, user_name="other")
    login_as(http_client, user_name="other")

    response = http_client.patch(f"/api/users/{first_user_id}", json={"display_name": "Hacked"})

    assert response.status_code == 404
