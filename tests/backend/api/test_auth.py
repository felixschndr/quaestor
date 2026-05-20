import pytest
from fastapi.testclient import TestClient
from source.backend.services.session_service import COOKIE_NAME
from source.backend.services.user_service import (
    ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME,
)

from tests.backend.conftest import (
    DISPLAY_NAME,
    USER_NAME,
    VALID_PASSWORD,
    WRONG_PASSWORD,
    create_credential,
    register,
)


def test_register_returns_created_user_and_sets_session_cookie(http_client: TestClient):
    response = register(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["user_name"] == USER_NAME
    assert body["display_name"] == DISPLAY_NAME
    assert body["balance"] == 0.0
    assert COOKIE_NAME in response.cookies


def test_register_makes_first_user_admin_and_following_users_non_admin(http_client: TestClient):
    first = register(http_client, user_name="first")
    second = register(http_client, user_name="second")

    assert first.json()["admin"] is True
    assert second.json()["admin"] is False


@pytest.mark.parametrize(
    argnames="password",
    argvalues=[
        "",
        "Ab1!Ab1!Ab1!",
        "aB1!aB1!aB1!aB",
        "alllowercaseletters",
        "ALLUPPERCASELETTERS",
        "123456789012345",
        "!!!!!!!!!!!!!!!",
        "lower1234567!!!",
        "UPPER1234567!!!",
        "lowerUPPER!!!!!",
        "lowerUPPER12345",
    ],
)
def test_register_rejects_invalid_password(http_client: TestClient, password: str):
    response = register(http_client, password=password)

    assert response.status_code == 422


def test_login_succeeds_with_correct_credentials(http_client: TestClient):
    register(http_client, user_name="bob")

    response = http_client.post("/api/auth/login", json={"user_name": "bob", "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert response.json()["user_name"] == "bob"
    assert COOKIE_NAME in response.cookies


def test_login_fails_with_wrong_password(http_client: TestClient):
    register(http_client, user_name="carol")
    http_client.cookies.clear()

    response = http_client.post("/api/auth/login", json={"user_name": "carol", "password": WRONG_PASSWORD})

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_login_fails_for_unknown_user(http_client: TestClient):
    response = http_client.post("/api/auth/login", json={"user_name": "ghost", "password": VALID_PASSWORD})

    assert response.status_code == 401


def _set_cookie_attributes(response: TestClient) -> dict[str, str]:
    raw_cookie = response.headers["set-cookie"]
    parts = [part.strip() for part in raw_cookie.split(";")]
    attributes: dict[str, str] = {}
    for part in parts[1:]:
        if "=" in part:
            key, value = part.split(sep="=", maxsplit=1)
            attributes[key.strip().lower()] = value.strip()
        else:
            attributes[part.lower()] = ""
    return attributes


def test_login_without_remember_me_sets_session_only_cookie(http_client: TestClient):
    register(http_client, user_name="bob")
    http_client.cookies.clear()

    response = http_client.post("/api/auth/login", json={"user_name": "bob", "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert "max-age" not in _set_cookie_attributes(response)


def test_login_with_remember_me_sets_persistent_cookie(http_client: TestClient):
    register(http_client, user_name="bob")
    http_client.cookies.clear()

    response = http_client.post(
        "/api/auth/login", json={"user_name": "bob", "password": VALID_PASSWORD, "remember_me": True}
    )

    assert response.status_code == 200
    assert _set_cookie_attributes(response)["max-age"] == str(14 * 24 * 60 * 60)


def test_session_refresh_preserves_remember_me_flag(http_client: TestClient):
    register(http_client, user_name="bob")
    http_client.cookies.clear()
    http_client.post("/api/auth/login", json={"user_name": "bob", "password": VALID_PASSWORD, "remember_me": False})

    response = http_client.get("/api/auth/me")

    assert response.status_code == 200
    assert "max-age" not in _set_cookie_attributes(response)


def test_me_returns_current_user_when_authenticated(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["user_name"] == USER_NAME
    assert body["display_name"] == DISPLAY_NAME


def test_me_includes_credentials_and_balance(http_client: TestClient):
    register(http_client)
    create_credential(http_client)

    response = http_client.get("/api/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == 0.0
    assert [credential["bank"] for credential in body["credentials"]] == ["ing"]


def test_me_returns_401_when_unauthenticated(http_client: TestClient):
    response = http_client.get("/api/auth/me")

    assert response.status_code == 401


def test_registration_allowed_returns_true_by_default(http_client: TestClient):
    response = http_client.get("/api/auth/registration_allowed")

    assert response.status_code == 200
    assert response.json() == {"allowed": True}


def test_registration_allowed_reflects_env_variable(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, value="false")

    response = http_client.get("/api/auth/registration_allowed")

    assert response.status_code == 200
    assert response.json() == {"allowed": False}


def test_registration_allowed_is_public(http_client: TestClient):
    assert http_client.get("/api/auth/registration_allowed").status_code == 200


def test_password_requirements_returns_current_rules(http_client: TestClient):
    response = http_client.get("/api/auth/password_requirements")

    assert response.status_code == 200
    assert response.json() == {
        "min_length": 15,
        "rules": [
            {"name": "lower", "regex": "[a-z]", "description": "a lowercase letter"},
            {"name": "upper", "regex": "[A-Z]", "description": "an uppercase letter"},
            {"name": "digit", "regex": r"\d", "description": "a digit"},
            {"name": "symbol", "regex": "[^A-Za-z0-9]", "description": "a special character"},
        ],
    }


def test_password_requirements_is_public(http_client: TestClient):
    assert http_client.get("/api/auth/password_requirements").status_code == 200


def test_logout_returns_no_content_and_invalidates_session(http_client: TestClient):
    register(http_client, user_name="dave")
    assert http_client.get("/api/auth/me").status_code == 200

    logout_response = http_client.post("/api/auth/logout")

    assert logout_response.status_code == 204
    assert http_client.get("/api/auth/me").status_code == 401


def test_logout_without_session_cookie_is_idempotent(http_client: TestClient):
    response = http_client.post("/api/auth/logout")

    assert response.status_code == 204


def test_register_is_blocked_when_registration_is_disabled(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, value="false")

    response = register(http_client, user_name="late")

    assert response.status_code == 403


def test_register_succeeds_when_registration_is_explicitly_enabled(
    http_client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv(name=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, value="true")

    response = register(http_client, user_name="early")

    assert response.status_code == 201
