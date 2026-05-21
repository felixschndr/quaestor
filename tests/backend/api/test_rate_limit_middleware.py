import pytest
from fastapi.testclient import TestClient
from source.backend import rate_limit

from tests.backend.conftest import USER_NAME, VALID_PASSWORD


def test_strict_endpoint_returns_429_after_capacity_exhausted(
    http_client_logged_out: TestClient, monkeypatch: pytest.MonkeyPatch
):
    # Make the strict bucket trivially small so the test is fast and deterministic.
    monkeypatch.setattr(target=rate_limit, name="STRICT_CAPACITY", value=2)
    monkeypatch.setattr(target=rate_limit, name="STRICT_REFILL_PER_SECOND", value=0.001)

    payload = {"user_name": USER_NAME, "password": VALID_PASSWORD}
    first = http_client_logged_out.post("/api/auth/login", json=payload)
    second = http_client_logged_out.post("/api/auth/login", json=payload)
    third = http_client_logged_out.post("/api/auth/login", json=payload)

    assert first.status_code != 429
    assert second.status_code != 429
    assert third.status_code == 429
    assert third.json() == {"detail": "Too many requests"}
    assert int(third.headers["retry-after"]) >= 1


def test_non_strict_endpoint_uses_looser_global_limit(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=rate_limit, name="GLOBAL_CAPACITY", value=10)
    monkeypatch.setattr(target=rate_limit, name="STRICT_CAPACITY", value=1)

    # /api/auth/me is NOT in the strict set, so the global limit applies.
    for _ in range(5):
        assert http_client.get("/api/auth/me").status_code in (200, 401)


def test_strict_and_global_buckets_are_independent(http_client_logged_out: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=rate_limit, name="STRICT_CAPACITY", value=1)
    monkeypatch.setattr(target=rate_limit, name="STRICT_REFILL_PER_SECOND", value=0.001)
    monkeypatch.setattr(target=rate_limit, name="GLOBAL_CAPACITY", value=100)

    payload = {"user_name": USER_NAME, "password": VALID_PASSWORD}
    http_client_logged_out.post("/api/auth/login", json=payload)
    blocked = http_client_logged_out.post("/api/auth/login", json=payload)

    # The strict bucket is exhausted, but the global one is independent.
    assert blocked.status_code == 429
    assert http_client_logged_out.get("/api/auth/me").status_code in (200, 401)


def test_non_api_path_is_not_rate_limited(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=rate_limit, name="GLOBAL_CAPACITY", value=1)
    monkeypatch.setattr(target=rate_limit, name="STRICT_CAPACITY", value=1)

    # Routes outside /api never touch the rate limiter (the route doesn't exist → 404, not 429).
    for _ in range(5):
        assert http_client.get("/openapi.json").status_code == 200
