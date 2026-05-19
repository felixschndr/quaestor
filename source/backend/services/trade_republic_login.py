import logging
import secrets
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import requests
from pytr.api import TradeRepublicApi
from source.backend.exceptions import InvalidCredentialsError, InvalidTwoFactorError

logger = logging.getLogger(__name__)

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
    expired = [t for t, e in _pending_logins.items() if e.expires_at < now]
    for token in expired:
        _cleanup(_pending_logins.pop(token))
    if expired:
        logger.debug(f"Cleaned up {len(expired)} expired pending 2FA login(s)")


def start(credential_id: int, phone_no: str, pin: str) -> tuple[str, datetime]:
    logger.info(f"Initiating Trade Republic web login for credential {credential_id}")
    _cleanup_expired_pending_logins()

    temp_file = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
    cookies_path = Path(temp_file.name)
    temp_file.close()
    logger.debug(f"Created temporary cookie file for credential {credential_id}: {cookies_path}")

    trade_republic_client = TradeRepublicApi(
        phone_no=phone_no, pin=pin, save_cookies=True, cookies_file=str(cookies_path)
    )
    try:
        trade_republic_client.initiate_weblogin()
    except ValueError as e:
        cookies_path.unlink(missing_ok=True)
        error_message = f"Trade Republic rejected the login for credential {credential_id}: {e}"
        logger.warning(error_message)
        raise InvalidCredentialsError(error_message) from e

    token = secrets.token_urlsafe(24)
    expires_at = datetime.now() + DURATION_FOR_VALID_2FA_CODE
    _pending_logins[token] = _PendingLogin(
        trade_republic_client=trade_republic_client,
        cookies_path=cookies_path,
        credential_id=credential_id,
        expires_at=expires_at,
    )
    logger.info(f"2FA challenge issued for credential {credential_id}, expires at {expires_at:%Y-%m-%d %H:%M:%S}")
    return token, expires_at


def complete(challenge_token: str, credential_id: int, code: str) -> str:
    _cleanup_expired_pending_logins()

    pending_login = _pending_logins.pop(challenge_token, None)
    if pending_login is None or pending_login.credential_id != credential_id:
        error_message = f"Unknown or expired 2FA challenge for credential {credential_id}. Start the sync again."
        logger.warning(error_message)
        raise InvalidTwoFactorError(error_message)

    logger.debug(f"Matched pending 2FA login for credential {credential_id}, completing web login")
    try:
        pending_login.trade_republic_client.complete_weblogin(code)  # writes cookies via save_websession()
        cookies = pending_login.cookies_path.read_text()
        logger.info(f"2FA login completed for credential {credential_id}")
        return cookies
    except requests.exceptions.HTTPError as exc:
        error_message = f"Invalid 2FA code for credential {credential_id}: {exc}"
        logger.warning(error_message)
        raise InvalidTwoFactorError(error_message) from exc
    finally:
        _cleanup(pending_login)
