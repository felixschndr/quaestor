from fastapi.testclient import TestClient

from tests.backend.conftest import BANK_PASSWORD, create_credential, login_as, register


def test_create_credential_returns_created_credential(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["bank"] == "ing"
    assert body["accounts"] == []
    assert body["requires_two_factor_authentication"] is False


def test_list_credentials_returns_empty_when_none_exist(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    assert response.json() == []


def test_list_credentials_returns_own_credentials(http_client: TestClient):
    register(http_client)
    first_id = create_credential(http_client).json()["id"]
    second_id = create_credential(
        http_client, bank="trade_republic", credentials={"phone": "+49", "pin": "1234"}
    ).json()["id"]

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    body = response.json()
    assert {credential["id"] for credential in body} == {first_id, second_id}
    assert {credential["bank"] for credential in body} == {"ing", "trade_republic"}


def test_list_credentials_excludes_other_users_credentials(http_client: TestClient):
    register(http_client)
    alice_credential_id = create_credential(http_client).json()["id"]

    register(http_client, user_name="bob")
    login_as(http_client, user_name="bob")
    bob_credential_id = create_credential(http_client).json()["id"]

    response = http_client.get("/api/credentials")

    assert response.status_code == 200
    ids = {credential["id"] for credential in response.json()}
    assert ids == {bob_credential_id}
    assert alice_credential_id not in ids


def test_list_credentials_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/credentials").status_code == 401


def test_get_credential_returns_own_credential(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.get(f"/api/credentials/{credential_id}")

    assert response.status_code == 200
    assert response.json()["id"] == credential_id


def test_update_credential_changes_credentials(http_client: TestClient):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]

    response = http_client.patch(
        f"/api/credentials/{credential_id}",
        json={"credentials": {"username": "renamed", "password": BANK_PASSWORD}},
    )

    assert response.status_code == 200
    assert response.json()["id"] == credential_id


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


def test_list_all_possible_includes_supported_banks(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/list_all_possible")

    assert response.status_code == 200
    assert {"ing", "dkb", "dfs", "trade_republic"} == {bank["Bank Name"] for bank in response.json()}


def test_list_all_possible_only_includes_non_null_fields(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/credentials/list_all_possible")

    assert response.status_code == 200
    assert response.json() == [
        {
            "Bank Name": "ing",
            "Required Fields": ["username", "password"],
            "Bank Identifier": "50010517",
        },
        {
            "Bank Name": "dkb",
            "Required Fields": ["username", "password"],
            "Bank Identifier": "12030000",
        },
        {
            "Bank Name": "dfs",
            "Required Fields": ["username", "password", "customer"],
        },
        {
            "Bank Name": "trade_republic",
            "Required Fields": ["phone", "pin"],
            "Note": "The phone number has to be in the format +491234567890 "
            "(with '+' and country code and no spaces).",
        },
    ]


def test_create_credential_rejects_unknown_bank(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client, bank="not_a_bank")

    assert response.status_code == 422


def test_create_credential_for_dfs_requires_extra_fields(http_client: TestClient):
    register(http_client)

    response = create_credential(http_client, bank="dfs")

    assert response.status_code == 422
