from fastapi.testclient import TestClient
from source.backend.bank_handlers import FinTSHandler

from tests.backend.conftest import login_as, register

SEEDED_SECRET_NAME = FinTSHandler.PRODUCT_ID_SECRET_NAME


def test_secret_endpoints_require_authentication(http_client: TestClient):
    http_client.cookies.clear()

    assert http_client.get("/api/application_secrets").status_code == 401
    assert (
        http_client.post("/api/application_secrets", json={"name": SEEDED_SECRET_NAME, "value": "x"}).status_code == 401
    )


def test_secret_endpoints_require_admin(http_client: TestClient):
    register(http_client, user_name="admin")
    register(http_client, user_name="normal")
    login_as(http_client, user_name="normal")

    assert http_client.get("/api/application_secrets").status_code == 403
    assert (
        http_client.post("/api/application_secrets", json={"name": SEEDED_SECRET_NAME, "value": "x"}).status_code == 403
    )


def test_list_returns_seeded_secret_without_exposing_value(http_client: TestClient):
    register(http_client, user_name="admin")

    response = http_client.get("/api/application_secrets")

    assert response.status_code == 200
    secret = next(item for item in response.json() if item["name"] == SEEDED_SECRET_NAME)
    assert "value" not in secret
    assert isinstance(secret["id"], int)


def test_update_existing_secret_returns_id_and_name_only(http_client: TestClient):
    register(http_client, user_name="admin")

    response = http_client.post(
        "/api/application_secrets", json={"name": SEEDED_SECRET_NAME, "value": "new-product-id"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == SEEDED_SECRET_NAME
    assert "value" not in body


def test_update_unknown_secret_returns_not_found(http_client: TestClient):
    register(http_client, user_name="admin")

    response = http_client.post("/api/application_secrets", json={"name": "does_not_exist", "value": "x"})

    assert response.status_code == 404
