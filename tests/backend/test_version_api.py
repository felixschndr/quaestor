import pytest
from fastapi.testclient import TestClient

from source.backend.api import version as version_api
from source.backend.services import version_service


def test_version_endpoint_reports_available_update(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=version_api, name="get_project_version", value=lambda: "0.1.0")
    monkeypatch.setattr(
        target=version_service,
        name="get_latest_release",
        value=lambda: ("0.1.9", "https://github.com/felixschndr/quaestor/releases/tag/0.1.9"),
    )

    response = http_client.get("/api/version")

    assert response.status_code == 200
    assert response.json() == {
        "current": "0.1.0",
        "latest": "0.1.9",
        "update_available": True,
        "release_url": "https://github.com/felixschndr/quaestor/releases/tag/0.1.9",
    }


def test_version_endpoint_no_update_when_running_ahead(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=version_api, name="get_project_version", value=lambda: "0.1.11")
    monkeypatch.setattr(target=version_service, name="get_latest_release", value=lambda: ("0.1.9", "https://x/0.1.9"))

    body = http_client.get("/api/version").json()

    assert body["update_available"] is False


def test_version_endpoint_handles_github_failure(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=version_api, name="get_project_version", value=lambda: "0.1.11")
    monkeypatch.setattr(target=version_service, name="get_latest_release", value=lambda: None)

    body = http_client.get("/api/version").json()

    assert body == {
        "current": "0.1.11",
        "latest": None,
        "update_available": False,
        "release_url": None,
    }
