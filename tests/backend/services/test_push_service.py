from pathlib import Path

import pytest
from pywebpush import WebPushException

from source.backend.services.notifications import push_service
from tests.backend.conftest import FakeHttpResponse, assert_log_contains

SUBSCRIPTION_INFO = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "key", "auth": "auth"}}
PAYLOAD = {"title": "Quaestor"}


@pytest.fixture(autouse=True)
def isolate_vapid_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=push_service, name="DATA_DIR", value=tmp_path)
    monkeypatch.setattr(target=push_service, name="VAPID_PRIVATE_KEY_PATH", value=tmp_path / "vapid_private.pem")
    monkeypatch.setattr(target=push_service, name="_vapid", value=None)


def test_application_server_key_is_generated_persisted_and_reloaded(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    key = push_service.get_application_server_key()

    assert key
    assert_log_contains(caplog, message="Generated a new VAPID key pair at")
    assert "=" not in key  # urlsafe base64 without padding, as the browser Push API expects
    assert push_service.VAPID_PRIVATE_KEY_PATH.exists()

    monkeypatch.setattr(target=push_service, name="_vapid", value=None)
    assert push_service.get_application_server_key() == key


def test_send_reports_delivered_on_success(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=push_service, name="webpush", value=lambda **kwargs: None)

    result = push_service.send(subscription_info=SUBSCRIPTION_INFO, payload=PAYLOAD)

    assert result == push_service.PushResult(outcome=push_service.PushOutcome.DELIVERED)


def _patch_webpush_failure(monkeypatch: pytest.MonkeyPatch, exception: WebPushException) -> None:
    def raise_exception(**kwargs: object) -> None:
        raise exception

    monkeypatch.setattr(target=push_service, name="webpush", value=raise_exception)


@pytest.mark.parametrize(argnames="status_code", argvalues=[404, 410])
def test_send_reports_gone_subscription_as_expired(monkeypatch: pytest.MonkeyPatch, status_code: int):
    response = FakeHttpResponse(text="unsubscribed or expired", status_code=status_code)
    _patch_webpush_failure(monkeypatch, exception=WebPushException("gone", response=response))

    result = push_service.send(subscription_info=SUBSCRIPTION_INFO, payload=PAYLOAD)

    assert result.outcome == push_service.PushOutcome.EXPIRED
    assert result.detail == f"{status_code} unsubscribed or expired"


@pytest.mark.parametrize(
    argnames=["status_code", "text"],
    argvalues=[
        (400, '{"reason":"VapidPkHashMismatch"}'),
        (403, "the VAPID credentials in the authorization header do not correspond"),
    ],
)
def test_send_reports_stale_vapid_subscription_as_expired(monkeypatch: pytest.MonkeyPatch, status_code: int, text: str):
    response = FakeHttpResponse(text=text, status_code=status_code)
    _patch_webpush_failure(monkeypatch, exception=WebPushException("stale", response=response))

    result = push_service.send(subscription_info=SUBSCRIPTION_INFO, payload=PAYLOAD)

    assert result.outcome == push_service.PushOutcome.EXPIRED


def test_send_reports_unrelated_bad_request_as_failed(monkeypatch: pytest.MonkeyPatch):
    response = FakeHttpResponse(text='{"reason":"InvalidTtl"}', status_code=400)
    _patch_webpush_failure(monkeypatch, exception=WebPushException("bad ttl", response=response))

    result = push_service.send(subscription_info=SUBSCRIPTION_INFO, payload=PAYLOAD)

    assert result.outcome == push_service.PushOutcome.FAILED


def test_send_reports_other_http_errors_as_failed(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    response = FakeHttpResponse(text="server error", status_code=500)
    _patch_webpush_failure(monkeypatch, exception=WebPushException("boom", response=response))

    result = push_service.send(subscription_info=SUBSCRIPTION_INFO, payload=PAYLOAD)

    assert result.outcome == push_service.PushOutcome.FAILED
    assert result.detail == "500 server error"
    assert_log_contains(caplog, message="Push delivery failed")


def test_send_reports_failure_without_response_as_failed(monkeypatch: pytest.MonkeyPatch):
    _patch_webpush_failure(monkeypatch, exception=WebPushException("connection refused"))

    result = push_service.send(subscription_info=SUBSCRIPTION_INFO, payload=PAYLOAD)

    assert result.outcome == push_service.PushOutcome.FAILED
    assert "connection refused" in result.detail
