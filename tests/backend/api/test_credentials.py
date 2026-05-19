from fastapi.testclient import TestClient

from tests.backend.conftest import VALID_PASSWORD


def register(http_client: TestClient, name: str = "owner"):
    return http_client.post("/register", json={"name": name, "password": VALID_PASSWORD})


def create_credential(
    http_client: TestClient, bank: str = "ing", username: str = "bankuser", password: str = "bankpass"  # nosec: B107
):
    return http_client.post("/credentials", json={"bank": bank, "username": username, "password": password})


def test_create_credential_returns_created_credential(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["bank"] == "ing"
    assert body["username"] == "bankuser"
    assert body["accounts"] == []
    assert body["requires_two_factor_authentication"] is False


def test_get_credential_returns_own_credential(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.get(f"/credentials/{credential_id}")

    assert response.status_code == 200
    assert response.json()["id"] == credential_id


def test_update_credential_changes_username(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.patch(f"/credentials/{credential_id}", json={"username": "renamed"})

    assert response.status_code == 200
    assert response.json()["username"] == "renamed"


def test_delete_credential_removes_it(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    delete_response = http_client.delete(f"/credentials/{credential_id}")

    assert delete_response.status_code == 204
    assert http_client.get(f"/credentials/{credential_id}").status_code == 404


def test_get_unknown_credential_returns_not_found(http_client: TestClient):
    register(http_client)

    response = http_client.get("/credentials/999")

    assert response.status_code == 404


def test_list_all_possible_includes_supported_banks(http_client: TestClient):
    register(http_client)

    response = http_client.get("/credentials/list_all_possible")

    assert response.status_code == 200
    assert {"ing", "dkb", "dfs", "trade_republic"} == {bank["Bank Name"] for bank in response.json()}


def test_create_credential_rejects_unknown_bank(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client, bank="not_a_bank")

    assert response.status_code == 422


def test_create_credential_for_dfs_requires_extra_fields(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client, bank="dfs")

    assert response.status_code == 422
