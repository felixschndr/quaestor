import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from source.backend.api.notifications import push
from source.backend.models.notifications.push_subscription import PushSubscription
from source.backend.services.notifications import push_service
from source.backend.services.notifications.notification_service import NotificationResult
from source.backend.services.notifications.push_service import PushOutcome, PushResult
from tests.backend.conftest import (
    NOTIFICATION,
    PUSH_ENDPOINT,
    UNKNOWN_ID,
    assert_log_contains,
    register,
)

SUBSCRIPTION = {"endpoint": PUSH_ENDPOINT, "keys": {"p256dh": "key", "auth": "auth"}}


def test_get_public_key_is_public(http_client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=push_service, name="get_application_server_key", value=lambda: "server-key")

    response = http_client.get("/api/push/public-key")

    assert response.status_code == 200
    assert response.json()["public_key"] == "server-key"


@pytest.mark.parametrize(argnames="path", argvalues=["/api/push/subscribe", "/api/push/test"])
def test_push_endpoints_require_authentication(http_client: TestClient, path: str):
    assert http_client.post(path, json=SUBSCRIPTION).status_code == 401


def test_subscribe_stores_the_subscription(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    register(http_client)

    assert http_client.post("/api/push/subscribe", json=SUBSCRIPTION).status_code == 204
    assert_log_contains(caplog, message="Stored push subscription for")


def test_subscribe_updates_existing_subscription(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    http_client.post("/api/push/subscribe", json=SUBSCRIPTION)

    updated = {"endpoint": SUBSCRIPTION["endpoint"], "keys": {"p256dh": "new-key", "auth": "new-auth"}}
    assert http_client.post("/api/push/subscribe", json=updated).status_code == 204

    with session_factory() as db_session:
        rows = db_session.scalars(
            select(PushSubscription).where(PushSubscription.endpoint == SUBSCRIPTION["endpoint"])
        ).all()
    assert len(rows) == 1
    assert rows[0].p256dh == "new-key"


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


def test_test_push_reports_failed_delivery(
    http_client: TestClient,
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(target=push, name="SessionLocal", value=session_factory)
    monkeypatch.setattr(
        target=push_service,
        name="send",
        value=lambda subscription_info, payload: PushResult(outcome=PushOutcome.FAILED),
    )
    register(http_client)
    http_client.post("/api/push/subscribe", json=SUBSCRIPTION)

    response = http_client.post("/api/push/test")

    assert response.status_code == 200
    body = response.json()
    assert body["sent"] == 0
    assert body["failed"] == 1


def test_test_push_for_a_user_deleted_in_the_meantime_sends_nothing(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=push, name="SessionLocal", value=session_factory)

    assert push._notify_in_thread(user_id=UNKNOWN_ID, notification=NOTIFICATION) == NotificationResult()
