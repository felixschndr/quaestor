import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from source.backend import main
from source.backend.logging_utils import NO_SESSION_LOG_LABEL
from source.backend.services.auth.session_service import COOKIE_NAME
from source.backend.services.auth.user_service import ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME
from tests.backend.conftest import (
    DISPLAY_NAME,
    EURO,
    NON_DEFAULT_CURRENCY,
    SECOND_USER_NAME,
    USER_NAME,
    VALID_PASSWORD,
    WRONG_PASSWORD,
    assert_log_contains,
    create_credential,
    prime_csrf,
    register,
)


def test_register_returns_created_user_and_sets_session_cookie(
    http_client: TestClient, caplog: pytest.LogCaptureFixture
):
    response = register(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["user_name"] == USER_NAME
    assert body["display_name"] == DISPLAY_NAME
    assert body["balance"] == 0.0
    assert COOKIE_NAME in response.cookies
    assert_log_contains(caplog=caplog, message=f"Registered <User(id={body['id']},")
    assert_log_contains(caplog=caplog, message="Created session <UserSession(id=1, user_id")


def test_register_rejects_duplicate_user_name(http_client: TestClient):
    first = register(http_client)
    assert first.status_code == 201

    second = register(http_client, display_name="Someone Else")

    assert second.status_code == 409
    assert second.json()["detail"] == f"User name '{USER_NAME}' is already taken"


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


def test_login_succeeds_with_correct_credentials(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    register(http_client, user_name=USER_NAME)

    response = http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert response.json()["user_name"] == USER_NAME
    assert COOKIE_NAME in response.cookies
    assert_log_contains(caplog=caplog, message="Created session <UserSession(id=2, user_id")


def test_login_fails_with_wrong_password(http_client_logged_out: TestClient):
    response = http_client_logged_out.post("/api/auth/login", json={"user_name": USER_NAME, "password": WRONG_PASSWORD})

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_login_fails_for_unknown_user(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    response = http_client.post("/api/auth/login", json={"user_name": SECOND_USER_NAME, "password": VALID_PASSWORD})

    assert response.status_code == 401
    assert_log_contains(caplog=caplog, message=f'User with the user_name "{SECOND_USER_NAME}" not found')


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


@pytest.mark.parametrize(
    argnames=("login_json", "expected_max_age"),
    argvalues=[
        ({"user_name": USER_NAME, "password": VALID_PASSWORD}, None),
        ({"user_name": USER_NAME, "password": VALID_PASSWORD, "remember_me": True}, str(14 * 24 * 60 * 60)),
    ],
)
def test_login_remember_me_controls_cookie_max_age(
    http_client_logged_out: TestClient, login_json: dict, expected_max_age: str | None
):
    response = http_client_logged_out.post("/api/auth/login", json=login_json)

    assert response.status_code == 200
    attributes = _set_cookie_attributes(response)
    if expected_max_age is None:
        assert "max-age" not in attributes
    else:
        assert attributes["max-age"] == expected_max_age


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


@pytest.mark.parametrize(argnames=("scheme", "expected_secure"), argvalues=[("http", False), ("https", True)])
def test_session_cookie_secure_follows_request_scheme(
    http_client_logged_out: TestClient, scheme: str, expected_secure: bool
):
    response = http_client_logged_out.post(
        f"{scheme}://testserver/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD}
    )

    assert ("secure" in _set_cookie_attributes(response)) == expected_secure


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


def test_register_defaults_theme_language_and_currency(http_client: TestClient):
    response = register(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["theme"] == "SYSTEM"
    assert body["language"] == "en"
    assert body["currency"] == EURO


def test_register_accepts_explicit_theme_language_and_currency(http_client: TestClient):
    response = register(http_client, theme="LIGHT", language="de", currency=NON_DEFAULT_CURRENCY)

    assert response.status_code == 201
    body = response.json()
    assert body["theme"] == "LIGHT"
    assert body["language"] == "de"
    assert body["currency"] == NON_DEFAULT_CURRENCY


@pytest.mark.parametrize(argnames=("field", "value"), argvalues=[("theme", "neon"), ("currency", "XYZ")])
def test_register_rejects_invalid_field(http_client: TestClient, field: str, value: str):
    response = register(http_client, **{field: value})

    assert response.status_code == 422


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


def test_logout_returns_no_content_and_invalidates_session(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    register(http_client, user_name="dave")
    assert http_client.get("/api/auth/me").status_code == 200

    logout_response = http_client.post("/api/auth/logout")

    assert logout_response.status_code == 204
    assert http_client.get("/api/auth/me").status_code == 401
    assert_log_contains(caplog, message="Deleted session <UserSession(")


def test_logout_without_session_cookie_is_idempotent(http_client: TestClient):
    response = http_client.post("/api/auth/logout")

    assert response.status_code == 204


@pytest.mark.parametrize(argnames=("env_value", "expected_status"), argvalues=[("false", 403), ("true", 201)])
def test_register_respects_registration_toggle(
    http_client: TestClient, monkeypatch: pytest.MonkeyPatch, env_value: str, expected_status: int
):
    monkeypatch.setenv(name=ALLOW_NEW_USER_REGISTRATION_ENV_VARIABLE_NAME, value=env_value)

    response = register(http_client, user_name="toggle")

    assert response.status_code == expected_status


@pytest.fixture
def second_http_client(http_client: TestClient) -> Iterator[TestClient]:
    with TestClient(main.app) as client:
        prime_csrf(client)
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
