import json
import logging
from functools import partialmethod
from typing import Any

REDACTION_PLACEHOLDER = "XXXXXX"

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

    def exception(self, message: str, extra: Any = None, *, exc_info: Any = True) -> None:
        self.log(message, extra=extra, level=logging.ERROR, exc_info=exc_info)


def get_logger(name: str) -> StructuredLogger:
    return StructuredLogger(logging.getLogger(name))
