import pytest
from source.backend.helpers import utc_now
from source.backend.models.push_subscription import PushSubscription
from source.backend.services import notification_service, push_service
from source.backend.services.notification_service import Notification
from source.backend.services.push_service import PushOutcome, PushResult
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import assert_log_contains, make_user


def _add_subscription(db_session: Session, user_id: int, endpoint: str) -> PushSubscription:
    subscription = PushSubscription(
        user_id=user_id,
        endpoint=endpoint,
        p256dh="p256dh-key",
        auth="auth-key",
        created_at=utc_now(),
    )
    db_session.add(subscription)
    db_session.flush()
    return subscription


def test_to_payload_omits_optional_fields_when_unset():
    assert Notification(title="t", body="b").to_payload() == {"title": "t", "body": "b"}
    full = Notification(title="t", body="b", url="/account/3", tag="balance-3")
    assert full.to_payload() == {"title": "t", "body": "b", "url": "/account/3", "tag": "balance-3"}


def test_notify_user_without_subscriptions_sends_nothing(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    calls = []
    monkeypatch.setattr(target=push_service, name="send", value=lambda **kwargs: calls.append(kwargs))

    with session_factory() as db_session:
        user = make_user(db_session)
        db_session.commit()
        result = notification_service.notify_user(
            db_session=db_session, user=user, notification=Notification(title="t", body="b")
        )

    assert result.delivered == 0 and result.attempted == 0
    assert calls == []


def test_notify_user_delivers_to_all_subscriptions(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=push_service, name="send", value=lambda **kwargs: PushResult(PushOutcome.DELIVERED))

    with session_factory() as db_session:
        user = make_user(db_session)
        db_session.flush()
        _add_subscription(db_session=db_session, user_id=user.id, endpoint="https://push.example/a")
        _add_subscription(db_session=db_session, user_id=user.id, endpoint="https://push.example/b")
        db_session.commit()

        result = notification_service.notify_user(
            db_session=db_session, user=user, notification=Notification(title="t", body="b")
        )

    assert result.delivered == 2
    assert result.pruned == 0 and result.failed == 0
    assert_log_contains(caplog, message="Notified")


def test_notify_user_prunes_expired_subscriptions(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    def fake_send(subscription_info: dict, payload: dict) -> PushResult:
        if subscription_info["endpoint"].endswith("/gone"):
            return PushResult(outcome=PushOutcome.EXPIRED, detail="410 Gone")
        return PushResult(outcome=PushOutcome.DELIVERED)

    monkeypatch.setattr(target=push_service, name="send", value=fake_send)

    with session_factory() as db_session:
        user = make_user(db_session)
        db_session.flush()
        _add_subscription(db_session=db_session, user_id=user.id, endpoint="https://push.example/live")
        _add_subscription(db_session=db_session, user_id=user.id, endpoint="https://push.example/gone")
        db_session.commit()

        result = notification_service.notify_user(
            db_session=db_session, user=user, notification=Notification(title="t", body="b")
        )

        remaining = list(db_session.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id)))

    assert result.delivered == 1
    assert result.pruned == 1
    assert_log_contains(caplog, messages=["Pruned", "expired push subscription(s)"])
    assert [subscription.endpoint for subscription in remaining] == ["https://push.example/live"]


def test_notify_user_reports_first_failure_detail(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        target=push_service,
        name="send",
        value=lambda **kwargs: PushResult(outcome=PushOutcome.FAILED, detail="403 BadJwtToken"),
    )

    with session_factory() as db_session:
        user = make_user(db_session)
        db_session.flush()
        _add_subscription(db_session=db_session, user_id=user.id, endpoint="https://push.example/a")
        db_session.commit()

        result = notification_service.notify_user(
            db_session=db_session, user=user, notification=Notification(title="t", body="b")
        )

    assert result.delivered == 0
    assert result.failed == 1
    assert result.error == "403 BadJwtToken"
