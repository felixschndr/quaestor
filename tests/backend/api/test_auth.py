import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from source.backend import main
from source.backend.logging_utils import NO_SESSION_LOG_LABEL
from source.backend.security import csrf
from source.backend.services.session_service import COOKIE_NAME
from source.backend.services.user_service import (
    ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME,
)

from tests.backend.conftest import (
    DISPLAY_NAME,
    SECOND_USER_NAME,
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


def test_register_rejects_duplicate_user_name(http_client: TestClient):
    first = register(http_client)
    assert first.status_code == 201

    second = register(http_client, display_name="Someone Else")

    assert second.status_code == 409
    assert "already taken" in second.json()["detail"].lower()


def test_register_treats_user_name_case_insensitively(http_client: TestClient):
    first = register(http_client, user_name="Alice")
    assert first.status_code == 201
    assert first.json()["user_name"] == "alice"  # stored lower-cased

    second = register(http_client, user_name="ALICE", display_name="Other Alice")

    assert second.status_code == 409


def test_login_accepts_mixed_case_user_name(http_client: TestClient):
    register(http_client, user_name="alice")

    response = http_client.post("/api/auth/login", json={"user_name": "AlIcE", "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert response.json()["user_name"] == "alice"


def test_register_strips_whitespace_around_user_name(http_client: TestClient):
    response = register(http_client, user_name="   alice   ")

    assert response.status_code == 201
    assert response.json()["user_name"] == "alice"


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
    register(http_client, user_name=USER_NAME)

    response = http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert response.json()["user_name"] == USER_NAME
    assert COOKIE_NAME in response.cookies


def test_login_fails_with_wrong_password(http_client_logged_out: TestClient):
    response = http_client_logged_out.post("/api/auth/login", json={"user_name": USER_NAME, "password": WRONG_PASSWORD})

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_login_fails_for_unknown_user(http_client: TestClient):
    response = http_client.post("/api/auth/login", json={"user_name": SECOND_USER_NAME, "password": VALID_PASSWORD})

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


def test_login_without_remember_me_sets_session_only_cookie(http_client_logged_out: TestClient):
    response = http_client_logged_out.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert "max-age" not in _set_cookie_attributes(response)


def test_login_with_remember_me_sets_persistent_cookie(http_client_logged_out: TestClient):
    response = http_client_logged_out.post(
        "/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD, "remember_me": True}
    )

    assert response.status_code == 200
    assert _set_cookie_attributes(response)["max-age"] == str(14 * 24 * 60 * 60)


def test_session_refresh_preserves_remember_me_flag(http_client_logged_out: TestClient):
    http_client_logged_out.post(
        "/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD, "remember_me": False}
    )

    response = http_client_logged_out.get("/api/auth/me")

    assert response.status_code == 200
    assert "max-age" not in _set_cookie_attributes(response)


def test_session_cookie_is_httponly_lax_and_path_root(http_client_logged_out: TestClient):
    response = http_client_logged_out.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    attrs = _set_cookie_attributes(response)
    assert "httponly" in attrs
    assert attrs["samesite"].lower() == "lax"
    assert attrs["path"] == "/"


def test_session_cookie_is_not_secure_when_env_var_unset(
    http_client_logged_out: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv(name="SESSION_COOKIE_SECURE", raising=False)

    response = http_client_logged_out.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    assert "secure" not in _set_cookie_attributes(response)


def test_session_cookie_is_secure_when_env_var_true(
    http_client_logged_out: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv(name="SESSION_COOKIE_SECURE", value="true")

    response = http_client_logged_out.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    assert "secure" in _set_cookie_attributes(response)


def test_me_returns_current_user_when_authenticated(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    register(http_client)

    with caplog.at_level(logging.DEBUG):
        response = http_client.get("/api/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["user_name"] == USER_NAME
    assert body["display_name"] == DISPLAY_NAME
    authenticated = next(record for record in caplog.records if "authenticated" in record.getMessage())
    assert authenticated.session not in (None, NO_SESSION_LOG_LABEL)
    summary = next(record for record in caplog.records if record.name == "main" and "-> 200" in record.getMessage())
    assert summary.session == authenticated.session


def test_me_includes_credentials_and_balance(http_client: TestClient):
    register(http_client)
    create_credential(http_client)

    response = http_client.get("/api/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["balance"] == 0.0
    assert [credential["bank"] for credential in body["credentials"]] == ["fints"]


def test_me_returns_401_when_unauthenticated(http_client: TestClient):
    response = http_client.get("/api/auth/me")

    assert response.status_code == 401


def test_register_defaults_theme_to_system(http_client: TestClient):
    response = register(http_client)

    assert response.status_code == 201
    assert response.json()["theme"] == "SYSTEM"


def test_register_accepts_explicit_theme(http_client: TestClient):
    response = http_client.post(
        "/api/auth/register",
        json={
            "user_name": USER_NAME,
            "display_name": DISPLAY_NAME,
            "password": VALID_PASSWORD,
            "theme": "LIGHT",
        },
    )

    assert response.status_code == 201
    assert response.json()["theme"] == "LIGHT"


def test_register_rejects_invalid_theme(http_client: TestClient):
    response = http_client.post(
        "/api/auth/register",
        json={
            "user_name": USER_NAME,
            "display_name": DISPLAY_NAME,
            "password": VALID_PASSWORD,
            "theme": "neon",
        },
    )

    assert response.status_code == 422


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


@pytest.fixture
def second_http_client(http_client: TestClient) -> Iterator[TestClient]:
    with TestClient(main.app) as client:
        client.get("/api/auth/registration_allowed")
        csrf_token = client.cookies.get(csrf.COOKIE_NAME)
        if csrf_token:
            client.headers[csrf.HEADER_NAME] = csrf_token
        yield client


def test_two_logged_in_users_each_resolve_to_their_own_identity(
    http_client: TestClient, second_http_client: TestClient
):
    register(http_client, user_name=USER_NAME)
    register(second_http_client, user_name=SECOND_USER_NAME)

    assert http_client.get("/api/auth/me").json()["user_name"] == USER_NAME
    assert second_http_client.get("/api/auth/me").json()["user_name"] == SECOND_USER_NAME


def test_session_cookie_resolves_strictly_to_its_owner(http_client: TestClient, second_http_client: TestClient):
    register(http_client, user_name=USER_NAME)
    register(second_http_client, user_name=SECOND_USER_NAME)
    other_users_session = second_http_client.cookies.get(COOKIE_NAME)

    http_client.cookies.set(name=COOKIE_NAME, value=other_users_session)

    assert http_client.get("/api/auth/me").json()["user_name"] == SECOND_USER_NAME
