import logging
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from source.backend import logging_utils, main
from source.backend.logging_utils import (
    NO_SESSION_LOG_LABEL,
    REDACTION_PLACEHOLDER,
    SYSTEM_LOG_LABEL,
    get_logger,
    redact,
    redact_headers,
    session_log_context,
)
from tests.backend.conftest import PIN, VALID_PASSWORD, assert_log_contains, register


@pytest.mark.parametrize(
    argnames="data,expected",
    argvalues=[
        ({"password": "secret"}, {"password": REDACTION_PLACEHOLDER}),  # nosec B105
        ({"PassWord": "secret"}, {"PassWord": REDACTION_PLACEHOLDER}),  # nosec B105
        ({"username": "bob", "id": 3}, {"username": "bob", "id": 3}),
        ({"outer": {"api_key": "k", "ok": 1}}, {"outer": {"api_key": REDACTION_PLACEHOLDER, "ok": 1}}),
        ({"items": [{"pin": PIN}, {"keep": "v"}]}, {"items": [{"pin": REDACTION_PLACEHOLDER}, {"keep": "v"}]}),
        ("plain string", "plain string"),
        (42, 42),
    ],
)
def test_redact_replaces_only_sensitive_keys(data: object, expected: object):
    assert redact(data) == expected


def test_redact_handles_unknown_types_without_raising():
    sentinel = object()

    assert redact(sentinel) is sentinel


def test_redact_headers_keeps_only_whitelisted_headers():
    headers = {"host": "localhost", "authorization": "Bearer token", "cookie": "session=abc"}

    result = redact_headers(headers)

    assert result == {
        "host": "localhost",
        "authorization": REDACTION_PLACEHOLDER,
        "cookie": REDACTION_PLACEHOLDER,
    }


def test_extra_is_omitted_for_non_debug_levels(caplog: pytest.LogCaptureFixture):
    logger = get_logger("test.logging.info")

    logger.info("user created", extra={"password": VALID_PASSWORD})

    assert caplog.records[0].getMessage() == "user created"
    assert VALID_PASSWORD not in caplog.text


def test_extra_is_appended_and_redacted_at_debug_level(caplog: pytest.LogCaptureFixture):
    logger = get_logger("test.logging.debug")

    with caplog.at_level(logging.DEBUG, logger="test.logging.debug"):
        logger.debug("payload", extra={"password": VALID_PASSWORD, "ok": 1})

    message = caplog.records[0].getMessage()
    assert message.startswith("payload | ")
    assert VALID_PASSWORD not in message
    assert REDACTION_PLACEHOLDER in message
    assert '"ok": 1' in message


def test_update_logs_the_entity_description(caplog: pytest.LogCaptureFixture):
    logger = get_logger("test.logging.update")
    entity = MagicMock()
    entity.describe_update.return_value = "Updated User 1: name 'old' --> 'new'"

    logger.update(state_before_update={"name": "old"}, entity_after_update=entity)

    entity.describe_update.assert_called_once_with(state_before_update={"name": "old"})
    assert_log_contains(caplog, message="Updated User 1: name 'old' --> 'new'")


def test_debug_extra_is_dropped_when_logger_below_debug(caplog: pytest.LogCaptureFixture):
    logger = get_logger("test.logging.disabled")

    logger.debug("invisible", extra={"password": VALID_PASSWORD})

    assert caplog.records == []


def test_redact_returns_placeholder_when_iteration_raises():
    class BrokenDict(dict):
        def items(self):
            raise RuntimeError("Something went wrong")

    assert redact(BrokenDict({"any": "value"})) == REDACTION_PLACEHOLDER


def test_render_extra_returns_placeholder_when_serialization_fails():
    assert logging_utils._render_extra({1: "a", "x": "y"}) == REDACTION_PLACEHOLDER


def test_request_middleware_redacts_password_and_auth_header(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.DEBUG):
        response = register(http_client, user_name="logged")
        http_client.post(
            "/api/auth/login",
            json={"user_name": "logged", "password": VALID_PASSWORD},
            headers={"Authorization": "Bearer leaktest"},
        )

    assert response.status_code == 201
    assert VALID_PASSWORD not in caplog.text
    assert "leaktest" not in caplog.text
    assert "[POST] [/api/auth/register] -> 201" in caplog.text


def test_request_summary_carries_session_label_on_endpoints_without_auth_dependency(
    http_client: TestClient, caplog: pytest.LogCaptureFixture
):
    register(http_client)

    http_client.get("/api/i18n/languages")

    summary = next(record for record in caplog.records if "/api/i18n/languages" in record.getMessage())
    assert summary.session not in (None, NO_SESSION_LOG_LABEL)


@pytest.fixture(autouse=True)
def restore_session_label():
    # Keep the contextvar from leaking a label set by one test into the next.
    with session_log_context(NO_SESSION_LOG_LABEL):
        yield


def test_session_log_context_sets_and_restores_label_on_records(caplog: pytest.LogCaptureFixture):
    logger = get_logger("test.logging.session.scope")

    with session_log_context(SYSTEM_LOG_LABEL):
        logger.info("inside")
    logger.info("outside")

    inside, outside = caplog.records
    assert inside.session == SYSTEM_LOG_LABEL
    assert outside.session == NO_SESSION_LOG_LABEL


def test_production_log_format_renders_level_session_component_and_strips_source_backend_prefix(
    caplog: pytest.LogCaptureFixture,
):
    logger = get_logger("source.backend.services.auth.session_service")

    with session_log_context("session=1 user=2"):
        logger.info("hello")

    rendered = logging.Formatter(main.LOG_FORMAT).format(caplog.records[0])
    assert "[INFO] [session=1 user=2] [services.auth.session_service] hello" in rendered
