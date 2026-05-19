from fastapi.testclient import TestClient

from tests.backend.conftest import VALID_PASSWORD


def register(http_client: TestClient, name: str):
    return http_client.post("/register", json={"name": name, "password": VALID_PASSWORD}).json()


def login_as(http_client: TestClient, name: str):
    http_client.cookies.clear()
    return http_client.post("/login", json={"name": name, "password": VALID_PASSWORD})


def create_credential(http_client: TestClient):
    return http_client.post(
        "/credentials", json={"bank": "ing", "username": "bankuser", "password": "bankpass"}  # nosec: B105
    ).json()


def test_credential_endpoints_require_authentication(http_client: TestClient):
    http_client.cookies.clear()

    assert http_client.get("/credentials/1").status_code == 401
    assert http_client.post("/credentials", json={}).status_code == 401


def test_user_endpoints_require_authentication(http_client: TestClient):
    http_client.cookies.clear()

    assert http_client.get("/users").status_code == 401


def test_user_cannot_read_other_users_credential(http_client: TestClient):
    register(http_client, name="admin")
    register(http_client, name="owner")
    login_as(http_client, name="owner")
    credential_id = create_credential(http_client)["id"]

    register(http_client, name="intruder")
    login_as(http_client, name="intruder")

    assert http_client.get(f"/credentials/{credential_id}").status_code == 404


def test_user_cannot_modify_or_delete_other_users_credential(http_client: TestClient):
    register(http_client, name="admin")
    register(http_client, name="owner")
    login_as(http_client, name="owner")
    credential_id = create_credential(http_client)["id"]

    register(http_client, name="intruder")
    login_as(http_client, name="intruder")

    assert http_client.patch(f"/credentials/{credential_id}", json={"username": "x"}).status_code == 404
    assert http_client.delete(f"/credentials/{credential_id}").status_code == 404


def test_user_can_access_only_their_own_user_resource(http_client: TestClient):
    admin = register(http_client, name="admin")
    other = register(http_client, name="other")
    login_as(http_client, name="other")

    assert http_client.get(f"/users/{other['id']}").status_code == 200
    assert http_client.get(f"/users/{admin['id']}").status_code == 404


def test_non_admin_cannot_elevate_users(http_client: TestClient):
    register(http_client, name="admin")
    target = register(http_client, name="normal")
    login_as(http_client, name="normal")

    response = http_client.patch(f"/users/{target['id']}/elevate")

    assert response.status_code == 403


def test_admin_can_elevate_user(http_client: TestClient):
    register(http_client, name="admin")
    target = register(http_client, name="normal")
    login_as(http_client, name="admin")

    response = http_client.patch(f"/users/{target['id']}/elevate")

    assert response.status_code == 200
    assert response.json()["admin"] is True


def test_first_registered_user_is_admin_and_others_are_not(http_client: TestClient):
    first = register(http_client, name="admin")
    second = register(http_client, name="normal")

    assert first["admin"] is True
    assert second["admin"] is False
