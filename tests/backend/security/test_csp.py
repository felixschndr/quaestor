import pytest
from fastapi.testclient import TestClient
from source.backend.security.csp import DEFAULT_POLICY, DOCS_POLICY, HEADER_NAME

from tests.backend.conftest import VALID_PASSWORD


@pytest.mark.parametrize(
    argnames="method, path, json_body, expected_status",
    argvalues=[
        ("get", "/api/settings", None, 200),  # API response
        ("post", "/api/auth/login", {"user_name": "ghost", "password": VALID_PASSWORD}, 401),  # error response
        ("get", "/openapi.json", None, 200),  # non-API response
    ],
)
def test_csp_header_is_set_on_every_response(
    http_client: TestClient, method: str, path: str, json_body: dict | None, expected_status: int
):
    response = http_client.request(method=method, url=path, json=json_body)

    assert response.status_code == expected_status
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


@pytest.mark.parametrize(argnames="directive", argvalues=["frame-ancestors 'none'", "object-src 'none'"])
def test_csp_default_policy_contains_blocking_directive(directive: str):
    assert directive in DEFAULT_POLICY
