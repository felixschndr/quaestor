from fastapi.testclient import TestClient
from source.backend.security import csrf

from tests.backend.conftest import (
    auth_header_for_api_key,
    create_api_key,
    login_as,
    register,
)


def _strip_session_auth(http_client: TestClient) -> None:
    http_client.cookies.clear()
    http_client.headers.pop(csrf.HEADER_NAME, None)


def test_create_returns_the_raw_token_exactly_once(http_client: TestClient):
    register(http_client)

    response = create_api_key(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["token"].startswith("qk_")
    assert body["name"] == "My script"
    assert body["last_used_at"] is None
    assert body["token"].startswith(body["prefix"])


def test_created_at_is_served_as_explicit_utc(http_client: TestClient):
    register(http_client)

    created_at = create_api_key(http_client).json()["created_at"]

    assert created_at.endswith("+00:00")


def test_list_never_exposes_the_raw_token(http_client: TestClient):
    register(http_client)
    created = create_api_key(http_client).json()

    listed = http_client.get("/api/api_keys")

    assert listed.status_code == 200
    keys = listed.json()
    assert len(keys) == 1
    assert "token" not in keys[0]
    assert keys[0]["name"] == "My script"
    assert keys[0]["prefix"] == created["prefix"]


def test_api_key_authenticates_a_data_request_and_stamps_last_used(http_client: TestClient):
    user = register(http_client).json()
    token = create_api_key(http_client).json()["token"]

    me = http_client.get("/api/auth/me", headers=auth_header_for_api_key(token))

    assert me.status_code == 200
    assert me.json()["id"] == user["id"]
    assert http_client.get("/api/api_keys").json()[0]["last_used_at"] is not None


def test_api_key_can_drive_a_write_endpoint_without_a_csrf_token(http_client: TestClient):
    register(http_client)
    token = create_api_key(http_client).json()["token"]
    _strip_session_auth(http_client)

    response = http_client.post("/api/users/sync", headers=auth_header_for_api_key(token))

    assert response.status_code == 202


def test_invalid_api_key_is_rejected(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/auth/me", headers=auth_header_for_api_key("qk_not-a-real-key"))

    assert response.status_code == 401


def test_api_key_cannot_reach_self_management_endpoints(http_client: TestClient):
    user_id = register(http_client).json()["id"]
    token = create_api_key(http_client).json()["token"]
    api_key_id = http_client.get("/api/api_keys").json()[0]["id"]
    _strip_session_auth(http_client)
    headers = auth_header_for_api_key(token)

    assert http_client.post(f"/api/users/{user_id}/2fa/setup", headers=headers).status_code == 401
    assert http_client.get(f"/api/users/{user_id}/sessions", headers=headers).status_code == 401
    assert http_client.delete(f"/api/users/{user_id}", headers=headers).status_code == 401
    assert http_client.get("/api/api_keys", headers=headers).status_code == 401
    assert http_client.post("/api/api_keys", json={"name": "x"}, headers=headers).status_code == 401
    assert http_client.delete(f"/api/api_keys/{api_key_id}", headers=headers).status_code == 401


def test_create_rejects_a_blank_name(http_client: TestClient):
    register(http_client)

    assert http_client.post("/api/api_keys", json={"name": "   "}).status_code == 422


def test_delete_removes_the_key(http_client: TestClient):
    register(http_client)
    api_key_id = create_api_key(http_client).json()["id"]

    deleted = http_client.delete(f"/api/api_keys/{api_key_id}")

    assert deleted.status_code == 204
    assert http_client.get("/api/api_keys").json() == []


def test_cannot_delete_another_users_key(http_client: TestClient):
    register(http_client, user_name="owner")
    api_key_id = create_api_key(http_client).json()["id"]

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    assert http_client.delete(f"/api/api_keys/{api_key_id}").status_code == 404


def test_endpoints_require_authentication(http_client: TestClient):
    assert http_client.get("/api/api_keys").status_code == 401
    assert http_client.post("/api/api_keys", json={"name": "x"}).status_code == 401
