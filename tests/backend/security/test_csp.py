from fastapi.testclient import TestClient
from source.backend.security.csp import DEFAULT_POLICY, HEADER_NAME

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


def test_csp_default_policy_blocks_unsafe_script_sources():
    assert "script-src 'self'" in DEFAULT_POLICY
    assert "'unsafe-inline'" not in DEFAULT_POLICY.split("script-src")[1].split(";")[0]


def test_csp_default_policy_blocks_framing():
    assert "frame-ancestors 'none'" in DEFAULT_POLICY


def test_csp_default_policy_blocks_objects():
    assert "object-src 'none'" in DEFAULT_POLICY
