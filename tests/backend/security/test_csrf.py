import pytest
from fastapi.testclient import TestClient
from source.backend import main
from source.backend.db import get_session
from source.backend.security import csrf
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import DISPLAY_NAME, USER_NAME, VALID_PASSWORD


@pytest.fixture
def raw_http_client(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    def override_get_session():
        with session_factory() as session:
            yield session

    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    main.app.dependency_overrides[get_session] = override_get_session
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


def test_get_request_does_not_require_csrf_token(raw_http_client: TestClient):
    response = raw_http_client.get("/api/auth/registration_allowed")

    assert response.status_code == 200


def test_get_request_issues_csrf_cookie_when_not_present(raw_http_client: TestClient):
    response = raw_http_client.get("/api/auth/registration_allowed")

    assert csrf.COOKIE_NAME in response.cookies
    assert response.cookies[csrf.COOKIE_NAME]


def test_get_request_does_not_re_issue_csrf_cookie_when_already_present(raw_http_client: TestClient):
    first = raw_http_client.get("/api/auth/registration_allowed")
    initial_token = first.cookies[csrf.COOKIE_NAME]

    second = raw_http_client.get("/api/auth/registration_allowed")

    assert csrf.COOKIE_NAME not in second.cookies  # not re-issued
    assert raw_http_client.cookies.get(csrf.COOKIE_NAME) == initial_token


def test_mutation_without_any_csrf_data_is_rejected(raw_http_client: TestClient):
    response = raw_http_client.post(
        "/api/auth/register", json={"user_name": USER_NAME, "display_name": DISPLAY_NAME, "password": VALID_PASSWORD}
    )

    assert response.status_code == 403
    assert "csrf" in response.json()["detail"].lower()


def test_mutation_with_cookie_but_no_header_is_rejected(raw_http_client: TestClient):
    raw_http_client.get("/api/auth/registration_allowed")  # primes cookie only

    response = raw_http_client.post(
        "/api/auth/register", json={"user_name": USER_NAME, "display_name": DISPLAY_NAME, "password": VALID_PASSWORD}
    )

    assert response.status_code == 403


def test_mutation_with_mismatched_header_is_rejected(raw_http_client: TestClient):
    raw_http_client.get("/api/auth/registration_allowed")
    raw_http_client.headers[csrf.HEADER_NAME] = "definitely-not-the-cookie-value"

    response = raw_http_client.post(
        "/api/auth/register", json={"user_name": USER_NAME, "display_name": DISPLAY_NAME, "password": VALID_PASSWORD}
    )

    assert response.status_code == 403


def test_mutation_with_matching_token_succeeds(raw_http_client: TestClient):
    raw_http_client.get("/api/auth/registration_allowed")
    raw_http_client.headers[csrf.HEADER_NAME] = raw_http_client.cookies[csrf.COOKIE_NAME]

    response = raw_http_client.post(
        "/api/auth/register", json={"user_name": USER_NAME, "display_name": DISPLAY_NAME, "password": VALID_PASSWORD}
    )

    assert response.status_code == 201


def test_non_api_mutation_is_not_validated(raw_http_client: TestClient):
    # Hit a URL outside /api — even without CSRF data, the middleware should pass it through.
    # The route does not exist, so we expect 404 from the router, not 403 from CSRF.
    response = raw_http_client.post("/not-the-api/something")

    assert response.status_code == 404


def test_csrf_cookie_is_not_httponly_so_the_spa_can_read_it(raw_http_client: TestClient):
    response = raw_http_client.get("/api/auth/registration_allowed")

    set_cookie_header = response.headers["set-cookie"]
    assert csrf.COOKIE_NAME in set_cookie_header
    assert "HttpOnly" not in set_cookie_header
