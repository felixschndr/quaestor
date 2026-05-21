from fastapi.testclient import TestClient
from source.backend.services import i18n_service


def test_list_languages_returns_supported_languages(http_client: TestClient):
    response = http_client.get("/api/i18n/languages")

    assert response.status_code == 200
    assert response.json() == {"languages": i18n_service.list_supported_languages()}


def test_list_languages_is_public(http_client: TestClient):
    assert http_client.get("/api/i18n/languages").status_code == 200
