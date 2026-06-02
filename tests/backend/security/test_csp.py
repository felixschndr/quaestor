from fastapi.testclient import TestClient
from source.backend.security.csp import DEFAULT_POLICY, DOCS_POLICY, HEADER_NAME

from tests.backend.conftest import VALID_PASSWORD


def test_csp_header_is_set_on_api_responses(http_client: TestClient):
    response = http_client.get("/api/auth/registration_allowed")

    assert response.headers[HEADER_NAME] == DEFAULT_POLICY


def test_csp_header_is_set_on_error_responses(http_client: TestClient):
    response = http_client.post("/api/auth/login", json={"user_name": "ghost", "password": VALID_PASSWORD})

    assert response.status_code == 401
    assert response.headers[HEADER_NAME] == DEFAULT_POLICY


def test_csp_header_is_set_on_non_api_responses(http_client: TestClient):
    response = http_client.get("/openapi.json")

    assert response.status_code == 200
    assert response.headers[HEADER_NAME] == DEFAULT_POLICY


def test_swagger_ui_is_disabled(http_client: TestClient):
    # `/docs` no longer serves Swagger UI. Depending on whether the SPA is mounted it is either a 404
    # or the SPA fallback (index.html) -- but never the Swagger page. The SPA is absent in CI (the
    # frontend dist is gitignored), so asserting on the absence of Swagger is the only robust check.
    response = http_client.get("/docs")

    assert "swagger-ui" not in response.text.lower()


def test_csp_relaxed_policy_is_set_on_redoc(http_client: TestClient):
    response = http_client.get("/redoc")

    assert response.status_code == 200
    assert response.headers[HEADER_NAME] == DOCS_POLICY


def test_csp_docs_policy_allows_cdn_and_inline_scripts():
    script_src = DOCS_POLICY.split("script-src")[1].split(";")[0]
    assert "https://cdn.jsdelivr.net" in script_src
    assert "'unsafe-inline'" in script_src


def test_csp_default_policy_blocks_unsafe_script_sources():
    assert "script-src 'self'" in DEFAULT_POLICY
    assert "'unsafe-inline'" not in DEFAULT_POLICY.split("script-src")[1].split(";")[0]


def test_csp_default_policy_blocks_framing():
    assert "frame-ancestors 'none'" in DEFAULT_POLICY


def test_csp_default_policy_blocks_objects():
    assert "object-src 'none'" in DEFAULT_POLICY
