import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.api.notifications import push
from source.backend.services.notifications import push_service
from source.backend.services.notifications.push_service import PushOutcome, PushResult
from tests.backend.conftest import assert_log_contains, register

SUBSCRIPTION = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "key", "auth": "auth"}}


def test_subscribe_stores_the_subscription(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)

    assert http_client.post("/api/push/subscribe", json=SUBSCRIPTION).status_code == 204
    assert_log_contains(caplog, message="Stored push subscription for")


def test_test_push_reports_delivery(
    http_client: TestClient,
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    monkeypatch.setattr(target=push, name="SessionLocal", value=session_factory)
    monkeypatch.setattr(
        target=push_service,
        name="send",
        value=lambda subscription_info, payload: PushResult(outcome=PushOutcome.DELIVERED),
    )
    register(http_client)
    http_client.post("/api/push/subscribe", json=SUBSCRIPTION)

    response = http_client.post("/api/push/test")

    assert response.status_code == 200
    assert response.json()["sent"] == 1
    assert_log_contains(caplog, message="Sent test push: 1 delivered for")
