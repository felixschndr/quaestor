from fastapi.testclient import TestClient

from tests.backend.conftest import login_as, register

SEEDED_SETTING_NAME = "Allow new user registration"


def test_setting_endpoints_require_authentication(http_client: TestClient):
    http_client.cookies.clear()

    assert http_client.get("/application_settings").status_code == 401
    payload = {"name": SEEDED_SETTING_NAME, "value": "false"}
    assert http_client.post("/application_settings", json=payload).status_code == 401


def test_setting_endpoints_require_admin(http_client: TestClient):
    register(http_client, name="admin")
    register(http_client, name="normal")
    login_as(http_client, name="normal")

    assert http_client.get("/application_settings").status_code == 403
    payload = {"name": SEEDED_SETTING_NAME, "value": "false"}
    assert http_client.post("/application_settings", json=payload).status_code == 403


def test_list_returns_seeded_setting_with_value(http_client: TestClient):
    register(http_client, name="admin")

    response = http_client.get("/application_settings")

    assert response.status_code == 200
    setting = next(item for item in response.json() if item["name"] == SEEDED_SETTING_NAME)
    assert setting["value"] == "true"
    assert isinstance(setting["id"], int)


def test_update_existing_setting_persists_new_value(http_client: TestClient):
    register(http_client, name="admin")

    update = http_client.post("/application_settings", json={"name": SEEDED_SETTING_NAME, "value": "false"})

    assert update.status_code == 201
    assert update.json()["name"] == SEEDED_SETTING_NAME
    listed = http_client.get("/application_settings").json()
    setting = next(item for item in listed if item["name"] == SEEDED_SETTING_NAME)
    assert setting["value"] == "false"


def test_update_unknown_setting_returns_not_found(http_client: TestClient):
    register(http_client, name="admin")

    response = http_client.post("/application_settings", json={"name": "does_not_exist", "value": "x"})

    assert response.status_code == 404
