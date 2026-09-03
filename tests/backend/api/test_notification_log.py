from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.helpers import utc_now
from source.backend.models.auth.user import User
from source.backend.services.notifications import notification_service
from source.backend.services.notifications.notification_service import Notification
from tests.backend.conftest import (
    SECOND_USER_NAME,
    VALID_PASSWORD,
    assert_log_contains,
    login_as,
    register,
    register_and_login,
)

NOTIFICATION = Notification(title="Payment overdue", body="Wallet: rent overdue", url="/contracts/7")


def _log(session_factory: sessionmaker, user_id: int, notification: Notification = NOTIFICATION) -> None:
    with session_factory() as db_session:
        notification_service.log_notification(
            db_session=db_session, user=db_session.get(entity=User, ident=user_id), notification=notification
        )


def test_a_notification_is_logged_even_without_a_push_subscription(
    session_factory: sessionmaker, http_client: TestClient
):
    user_id = register_and_login(http_client)

    with session_factory() as db_session:
        notification_service.notify_user(
            db_session=db_session, user=db_session.get(entity=User, ident=user_id), notification=NOTIFICATION
        )

    (entry,) = http_client.get("/api/notification_log").json()
    assert entry["title"] == "Payment overdue"
    assert entry["body"] == "Wallet: rent overdue"
    assert entry["url"] == "/contracts/7"
    assert entry["read_at"] is None


def test_a_notification_without_a_target_is_logged_too(session_factory: sessionmaker, http_client: TestClient):
    user_id = register_and_login(http_client)

    _log(session_factory, user_id=user_id, notification=Notification(title="Quaestor", body="Test push"))

    assert http_client.get("/api/notification_log").json()[0]["url"] is None


def test_entries_older_than_the_retention_are_dropped_on_the_next_write(
    session_factory: sessionmaker, http_client: TestClient, caplog: pytest.LogCaptureFixture
):
    user_id = register_and_login(http_client)
    _log(session_factory, user_id=user_id)

    with session_factory() as db_session:
        entry = notification_service.list_log(db_session=db_session, user=db_session.get(entity=User, ident=user_id))[0]
        entry.created_at = utc_now() - notification_service.LOG_RETENTION - timedelta(minutes=1)
        db_session.commit()

    _log(session_factory, user_id=user_id, notification=Notification(title="Fresh", body="Still here"))

    assert [entry["title"] for entry in http_client.get("/api/notification_log").json()] == ["Fresh"]
    assert_log_contains(caplog, message="Pruned 1 notification log entrie(s) older than 14 days")


def test_the_newest_notification_comes_first(session_factory: sessionmaker, http_client: TestClient):
    user_id = register_and_login(http_client)

    _log(session_factory, user_id=user_id, notification=Notification(title="Older", body="First"))
    _log(session_factory, user_id=user_id, notification=Notification(title="Newer", body="Second"))

    assert [entry["title"] for entry in http_client.get("/api/notification_log").json()] == ["Newer", "Older"]


def test_opening_an_entry_marks_it_read_and_leaves_other_users_out(
    session_factory: sessionmaker, http_client: TestClient
):
    user_id = register_and_login(http_client)
    _log(session_factory, user_id=user_id)

    (entry,) = http_client.get("/api/notification_log").json()
    assert http_client.post(f"/api/notification_log/{entry['id']}/read").json()["read_at"] is not None
    assert http_client.get("/api/notification_log").json()[0]["read_at"] is not None

    register(http_client, user_name=SECOND_USER_NAME)
    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)

    assert http_client.get("/api/notification_log").json() == []
    assert http_client.post(f"/api/notification_log/{entry['id']}/read").status_code == 404


def test_marking_everything_read_only_touches_the_callers_entries(
    session_factory: sessionmaker, http_client: TestClient, caplog: pytest.LogCaptureFixture
):
    user_id = register_and_login(http_client)
    _log(session_factory, user_id=user_id, notification=Notification(title="One", body="First"))
    _log(session_factory, user_id=user_id, notification=Notification(title="Two", body="Second"))

    other_id = register(http_client, user_name=SECOND_USER_NAME).json()["id"]
    _log(session_factory, user_id=other_id, notification=Notification(title="Theirs", body="Other user"))

    assert http_client.post("/api/notification_log/read").status_code == 204
    assert all(entry["read_at"] is not None for entry in http_client.get("/api/notification_log").json())
    assert_log_contains(caplog, message="Marked 2 notification log entrie(s) as read")

    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    assert http_client.get("/api/notification_log").json()[0]["read_at"] is None


def test_the_log_needs_a_session(http_client: TestClient):
    assert http_client.get("/api/notification_log").status_code == 401
