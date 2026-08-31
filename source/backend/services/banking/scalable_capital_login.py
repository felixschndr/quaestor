import base64
import io
import os
import queue
import re
import secrets
import shutil
import subprocess  # nosec B404
import tarfile
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from source.backend.exceptions import InvalidTwoFactorError
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.paths import SCALABLE_CLI_BIN

logger = get_logger(__name__)

# `sc` blocks until browser confirmation; uses plain subprocess (not asyncio) to survive across calls.
DURATION_FOR_USER_TO_COMPLETE_LOGIN = timedelta(minutes=15)
DURATION_TO_WAIT_FOR_PROCESS_ON_COMPLETE = timedelta(seconds=10)
# The prompt is printed within seconds of process start; the 15 minutes are the user's, see complete().
DURATION_TO_WAIT_FOR_AUTH_URL_LINE = timedelta(seconds=30)

_AUTHORIZATION_URL_PREFIX = "open this url"
_DEVICE_CODE_PATTERN = re.compile(pattern=r"^verify the code (?P<code>\S+) in your browser\.?$", flags=re.IGNORECASE)
# `sc` renders the code through `emphasize_terminal` (auth.rs), so strip styling before matching.
_ANSI_ESCAPE_PATTERN = re.compile(pattern=r"\x1b\[[0-9;]*m")

_SESSION_STATE_ARCHIVE_KEY = "archive"

_CONFIG_TOML = """
[auth]
session_backend = "file"
signing_key_backend = "file"
"""


@dataclass
class _PendingLogin:
    process: subprocess.Popen
    stdout_lines: "queue.Queue[str | None]"
    config_dir: Path
    credential_id: int
    expires_at: datetime


_pending_logins: dict[str, _PendingLogin] = {}


def _cleanup(entry: _PendingLogin) -> None:
    if entry.process.poll() is None:
        entry.process.kill()
    _remove_config_dir(entry.config_dir)


def _remove_config_dir(config_dir: Path) -> None:
    shutil.rmtree(config_dir, ignore_errors=True)


def _cleanup_expired_pending_logins() -> None:
    now = utc_now()
    expired = [t for t, e in _pending_logins.items() if e.expires_at < now]
    for token in expired:
        _cleanup(_pending_logins.pop(token))
    if expired:
        logger.debug(f"Cleaned up {len(expired)} expired pending Scalable Capital login(s)")


def cli_config_dir(config_dir: Path) -> Path:
    return config_dir / ".config" / "scalable-cli"


def _write_config(config_dir: Path) -> None:
    scalable_cli_dir = cli_config_dir(config_dir)
    scalable_cli_dir.mkdir(parents=True, exist_ok=True)
    (scalable_cli_dir / "config.toml").write_text(_CONFIG_TOML)


def subprocess_env(config_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["HOME"] = str(config_dir)
    env["XDG_CONFIG_HOME"] = str(config_dir / ".config")
    return env


def _pump_stdout(process: subprocess.Popen, sink: "queue.Queue[str | None]") -> None:
    # Drains stdout in a daemon thread for the process lifetime; `None` sentinel signals EOF.
    assert process.stdout is not None  # stdout is always piped in start()
    try:
        for raw_line in process.stdout:
            sink.put(raw_line.rstrip("\n"))
    finally:
        sink.put(None)


def _next_line(sink: "queue.Queue[str | None]", deadline: datetime, credential_id: int) -> str | None:
    remaining = (deadline - utc_now()).total_seconds()
    if remaining <= 0:
        raise InvalidTwoFactorError(f"Scalable Capital login timed out for credential {credential_id}")
    try:
        return sink.get(timeout=remaining)
    except queue.Empty as e:
        raise InvalidTwoFactorError(f"Scalable Capital login timed out for credential {credential_id}") from e


def _read_login_prompt(sink: "queue.Queue[str | None]", credential_id: int) -> tuple[str, str | None]:
    # `sc` prints "Open this URL:\n<url>\n\nVerify the code <CODE> in your browser." (auth.rs)
    deadline = utc_now() + DURATION_TO_WAIT_FOR_AUTH_URL_LINE
    authorization_url: str | None = None
    while True:
        line = _next_line(sink=sink, deadline=deadline, credential_id=credential_id)
        if line is None:
            raise InvalidTwoFactorError(
                f"Scalable Capital login process ended without an authorization URL for credential {credential_id}"
            )
        stripped = _ANSI_ESCAPE_PATTERN.sub(repl="", string=line).strip()
        if authorization_url is None:
            if stripped.lower().startswith(_AUTHORIZATION_URL_PREFIX):
                url_line = _next_line(sink=sink, deadline=deadline, credential_id=credential_id)
                if not url_line or not url_line.strip():
                    raise InvalidTwoFactorError(
                        f"Scalable Capital login did not print an authorization URL for credential {credential_id}"
                    )
                authorization_url = url_line.strip()
                if "user_code=" in authorization_url:
                    # The URL already carries the code; no need to wait for the follow-up line.
                    return authorization_url, None
            continue
        device_code_match = _DEVICE_CODE_PATTERN.match(stripped)
        if device_code_match is not None:
            return authorization_url, device_code_match.group("code")


def start(credential_id: int) -> tuple[str, str, str | None, datetime]:
    logger.info(f"Initiating Scalable Capital device-code login for credential {credential_id}")
    _cleanup_expired_pending_logins()

    config_dir = Path(tempfile.mkdtemp(prefix="scalable-cli-"))
    _write_config(config_dir)

    process = subprocess.Popen(  # nosec B603
        [str(SCALABLE_CLI_BIN), "login", "--local-read-only"],
        env=subprocess_env(config_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    stdout_lines: "queue.Queue[str | None]" = queue.Queue()
    reader_thread = threading.Thread(target=_pump_stdout, args=(process, stdout_lines), daemon=True)
    reader_thread.start()

    try:
        authorization_url, device_code = _read_login_prompt(sink=stdout_lines, credential_id=credential_id)
    except Exception:
        process.kill()
        _remove_config_dir(config_dir)
        raise

    token = secrets.token_urlsafe(24)
    expires_at = utc_now() + DURATION_FOR_USER_TO_COMPLETE_LOGIN
    _pending_logins[token] = _PendingLogin(
        process=process,
        stdout_lines=stdout_lines,
        config_dir=config_dir,
        credential_id=credential_id,
        expires_at=expires_at,
    )
    logger.info(f"Scalable Capital device-code challenge issued for credential {credential_id}")
    return token, authorization_url, device_code, expires_at


def read_session_state(config_dir: Path) -> dict[str, str]:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        archive.add(name=str(config_dir), arcname=".")
    return {_SESSION_STATE_ARCHIVE_KEY: base64.b64encode(buffer.getvalue()).decode()}


def write_session_state(config_dir: Path, session_state: dict[str, str]) -> None:
    encoded = session_state.get(_SESSION_STATE_ARCHIVE_KEY)
    if not encoded:
        raise ValueError("Scalable Capital session state does not contain a CLI config archive")
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(encoded)), mode="r") as archive:
        archive.extractall(path=config_dir, filter="data")


def complete(challenge_token: str, credential_id: int) -> dict[str, str]:
    _cleanup_expired_pending_logins()

    # Peek without removing: on a TimeoutExpired below, the entry must stay so a "try again" call can find it.
    pending_login = _pending_logins.get(challenge_token)
    if pending_login is None or pending_login.credential_id != credential_id:
        error_message = (
            f"Unknown or expired Scalable Capital login challenge for credential {credential_id}. "
            "Start the sync again."
        )
        logger.warning(error_message)
        raise InvalidTwoFactorError(error_message)

    try:
        pending_login.process.wait(timeout=DURATION_TO_WAIT_FOR_PROCESS_ON_COMPLETE.total_seconds())
    except subprocess.TimeoutExpired as e:
        error_message = (
            f"Scalable Capital login for credential {credential_id} has not finished yet in the browser; try again."
        )
        logger.warning(error_message)
        raise InvalidTwoFactorError(error_message) from e

    del _pending_logins[challenge_token]

    if pending_login.process.returncode != 0:
        error_message = f"Scalable Capital login failed for credential {credential_id}"
        logger.warning(error_message)
        _remove_config_dir(pending_login.config_dir)
        raise InvalidTwoFactorError(error_message)

    session_state = read_session_state(pending_login.config_dir)
    _remove_config_dir(pending_login.config_dir)
    logger.info(f"Scalable Capital login completed for credential {credential_id}")
    return session_state
