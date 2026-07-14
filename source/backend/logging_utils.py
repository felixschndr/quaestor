from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from functools import partialmethod
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Type-only import: keeps this low-level logging module free of the ORM/sqlalchemy
    # dependency at runtime (e.g. transaction_category imports get_logger).
    from source.backend.models.base import Base

REDACTION_PLACEHOLDER = "XXXXXX"

NO_SESSION_LOG_LABEL = "-"
SYSTEM_LOG_LABEL = "system"

LOGGER_NAME_PREFIX = "source.backend."

_session_log_label: ContextVar[str] = ContextVar("session_log_label", default=NO_SESSION_LOG_LABEL)


def set_session_log_label(label: str) -> None:
    _session_log_label.set(label)


@contextmanager
def session_log_context(label: str) -> Iterator[None]:
    # Bind a label for the duration of a block and restore the previous one afterwards.
    # Used by background tasks, which have no request to set the label for them.
    token = _session_log_label.set(label)
    try:
        yield
    finally:
        _session_log_label.reset(token)


def _install_session_log_record_factory() -> None:
    # Attach the current session label to every LogRecord so the formatter can render
    # `%(session)s`. Wrapping whatever factory is already installed keeps us composable
    # and idempotent (importing this module twice must not stack factories).
    existing_factory = logging.getLogRecordFactory()
    if getattr(existing_factory, "_injects_session_label", False):
        return

    def factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = existing_factory(*args, **kwargs)
        record.session = _session_log_label.get()
        return record

    factory._injects_session_label = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(factory)


_install_session_log_record_factory()

# Blacklist: any dict key whose lowercased name contains one of these fragments gets its value replaced
SENSITIVE_KEY_FRAGMENTS = frozenset(
    {
        "password",
        "passwort",
        "pwd",
        "pin",
        "secret",
        "token",
        "authorization",
        "cookie",
        "session_state",
        "credential",
        "api_key",
        "apikey",
        "private_key",
        "encryption_key",
    }
)

# Whitelist: only these request/response headers are logged verbatim
SAFE_HTTP_HEADERS = frozenset(
    {
        "host",
        "user-agent",
        "accept",
        "accept-encoding",
        "accept-language",
        "content-type",
        "content-length",
        "referer",
        "origin",
    }
)


def _key_is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in SENSITIVE_KEY_FRAGMENTS)


def redact(data: Any) -> Any:
    # Recursively replace sensitive values.
    try:
        if isinstance(data, dict):
            return {
                key: (REDACTION_PLACEHOLDER if isinstance(key, str) and _key_is_sensitive(key) else redact(value))
                for key, value in data.items()
            }
        if isinstance(data, (list, tuple, set)):
            return [redact(item) for item in data]
        return data
    except Exception:
        return REDACTION_PLACEHOLDER


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: (value if key.lower() in SAFE_HTTP_HEADERS else REDACTION_PLACEHOLDER) for key, value in headers.items()
    }


def _render_extra(extra: Any) -> str:
    try:
        return json.dumps(redact(extra), default=str, ensure_ascii=False, sort_keys=True)
    except Exception:
        return REDACTION_PLACEHOLDER


class StructuredLogger:
    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    def is_enabled_for(self, level: int) -> bool:
        return self._logger.isEnabledFor(level)

    def log(self, message: str, extra: Any = None, *, level: int, exc_info: Any = None) -> None:
        if not self._logger.isEnabledFor(level):
            return

        # Extras are attached whenever debug logging is active, regardless of
        # this record's own level - so an INFO line still carries them in debug.
        if extra and self._logger.isEnabledFor(logging.DEBUG):
            text = f"{message} | {_render_extra(extra)}"
        else:
            text = message
        self._logger.log(level=level, msg=text, exc_info=exc_info)

    debug = partialmethod(log, level=logging.DEBUG)
    info = partialmethod(log, level=logging.INFO)
    warning = partialmethod(log, level=logging.WARNING)
    error = partialmethod(log, level=logging.ERROR)

    def exception(self, message: str, extra: Any = None, exc_info: Any = True) -> None:
        self.log(message, extra=extra, level=logging.ERROR, exc_info=exc_info)

    def update(self, state_before_update: Mapping[str, Any], entity_after_update: Base) -> None:
        self.info(entity_after_update.describe_update(state_before_update=state_before_update))


def get_logger(name: str) -> StructuredLogger:
    return StructuredLogger(logging.getLogger(name.removeprefix(LOGGER_NAME_PREFIX)))
