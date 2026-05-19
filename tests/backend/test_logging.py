import logging

import pytest
from fastapi.testclient import TestClient
from source.backend.logging_utils import (
    REDACTION_PLACEHOLDER,
    get_logger,
    redact,
    redact_headers,
)

from tests.backend.conftest import VALID_PASSWORD, register


@pytest.mark.parametrize(
    argnames="data,expected",
    argvalues=[
        ({"password": "secret"}, {"password": REDACTION_PLACEHOLDER}),  # nosec: B105
        ({"PassWord": "secret"}, {"PassWord": REDACTION_PLACEHOLDER}),  # nosec: B105
        ({"username": "bob", "id": 3}, {"username": "bob", "id": 3}),
        ({"outer": {"api_key": "k", "ok": 1}}, {"outer": {"api_key": REDACTION_PLACEHOLDER, "ok": 1}}),
        ({"items": [{"pin": "1234"}, {"keep": "v"}]}, {"items": [{"pin": REDACTION_PLACEHOLDER}, {"keep": "v"}]}),
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

    with caplog.at_level(logging.INFO, logger="test.logging.info"):
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


def test_debug_extra_is_dropped_when_logger_below_debug(caplog: pytest.LogCaptureFixture):
    logger = get_logger("test.logging.disabled")

    with caplog.at_level(logging.INFO, logger="test.logging.disabled"):
        logger.debug("invisible", extra={"password": VALID_PASSWORD})

    assert caplog.records == []


def test_request_middleware_redacts_password_and_auth_header(http_client: TestClient, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.DEBUG):
        response = register(http_client, name="logged")
        http_client.post(
            "/login",
            json={"name": "logged", "password": VALID_PASSWORD},
            headers={"Authorization": "Bearer leaktest"},
        )

    assert response.status_code == 201
    assert VALID_PASSWORD not in caplog.text
    assert "leaktest" not in caplog.text
    assert "POST /register -> 201" in caplog.text
