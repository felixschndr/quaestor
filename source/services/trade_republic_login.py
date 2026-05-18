import secrets
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import requests
from pytr.api import TradeRepublicApi
from source.exceptions import InvalidCredentialsError, InvalidTwoFactorError

DURATION_FOR_VALID_2FA_CODE = timedelta(minutes=5)


@dataclass
class _PendingLogin:
    trade_republic_client: TradeRepublicApi
    cookies_path: Path
    credential_id: int
    expires_at: datetime


_pending_logins: dict[str, _PendingLogin] = {}


def _cleanup(entry: _PendingLogin) -> None:
    entry.cookies_path.unlink(missing_ok=True)


def _cleanup_expired_pending_logins() -> None:
    now = datetime.now()
    for token in [t for t, e in _pending_logins.items() if e.expires_at < now]:
        _cleanup(_pending_logins.pop(token))


def start(credential_id: int, phone_no: str, pin: str) -> tuple[str, datetime]:
    _cleanup_expired_pending_logins()

    temp_file = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
    cookies_path = Path(temp_file.name)
    temp_file.close()

    trade_republic_client = TradeRepublicApi(
        phone_no=phone_no, pin=pin, save_cookies=True, cookies_file=str(cookies_path)
    )
    try:
        trade_republic_client.initiate_weblogin()
    except ValueError as e:
        cookies_path.unlink(missing_ok=True)
        raise InvalidCredentialsError(f"Trade Republic rejected the login: {e}") from e

    token = secrets.token_urlsafe(24)
    expires_at = datetime.now() + DURATION_FOR_VALID_2FA_CODE
    _pending_logins[token] = _PendingLogin(trade_republic_client, cookies_path, credential_id, expires_at)
    return token, expires_at


def complete(challenge_token: str, credential_id: int, code: str) -> str:
    _cleanup_expired_pending_logins()

    pending_login = _pending_logins.pop(challenge_token, None)
    if pending_login is None or pending_login.credential_id != credential_id:
        raise InvalidTwoFactorError("Unknown or expired 2FA challenge. Start the sync again.")

    try:
        pending_login.trade_republic_client.complete_weblogin(code)  # writes cookies via save_websession()
        return pending_login.cookies_path.read_text()
    except requests.exceptions.HTTPError as exc:
        raise InvalidTwoFactorError(f"Invalid 2FA code: {exc}") from exc
    finally:
        _cleanup(pending_login)
