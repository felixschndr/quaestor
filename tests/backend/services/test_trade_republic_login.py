from datetime import timedelta
from pathlib import Path

import pytest
import requests

from source.backend.exceptions import (
    BankRateLimitedError,
    InvalidCredentialsError,
    InvalidTwoFactorError,
)
from source.backend.helpers import utc_now
from source.backend.services.banking import trade_republic_login as module
from tests.backend.conftest import (
    PHONE_NUMBER,
    PIN,
    TWO_FACTOR_CODE,
    assert_log_contains,
)


@pytest.fixture(autouse=True)
def isolate_pending_logins(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=module, name="_pending_logins", value={})


def _http_error(status_code: int) -> requests.exceptions.HTTPError:
    response = requests.Response()
    response.status_code = status_code
    return requests.exceptions.HTTPError(f"{status_code} Client Error", response=response)


def _patch_client(monkeypatch: pytest.MonkeyPatch, initiate_side_effect: Exception) -> None:
    class _FakeApi:
        def __init__(self, **kwargs: object) -> None:
            pass

        def initiate_weblogin(self) -> None:
            raise initiate_side_effect

    monkeypatch.setattr(target=module, name="TradeRepublicApi", value=_FakeApi)


def test_start_translates_http_400_into_invalid_credentials(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    # Trade Republic answers 400 to the weblogin when the phone number / PIN is wrong.
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=_http_error(400))

    with pytest.raises(InvalidCredentialsError):
        module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)

    assert_log_contains(caplog, messages=["Initiating Trade Republic web login", "Trade Republic rejected the login"])


def test_start_translates_value_error_into_invalid_credentials(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=ValueError("bad phone number"))

    with pytest.raises(InvalidCredentialsError):
        module.start(credential_id=1, phone_no="nonsense", pin=PIN)

    assert_log_contains(caplog, message="Trade Republic rejected the login for credential 1")


def test_start_reraises_server_errors_as_generic(monkeypatch: pytest.MonkeyPatch):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=_http_error(503))

    with pytest.raises(requests.exceptions.HTTPError):
        module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)


def test_start_translates_rate_limit_into_bank_rate_limited(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=_http_error(429))

    with pytest.raises(BankRateLimitedError):
        module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)

    assert_log_contains(caplog, message="Trade Republic rate limited the login for credential 1")


def _patch_successful_client(
    monkeypatch: pytest.MonkeyPatch, complete_side_effect: Exception | None = None
) -> list[Path]:
    cookie_paths: list[Path] = []

    class _FakeApi:
        def __init__(self, **kwargs: object) -> None:
            self._cookies_file = Path(str(kwargs["cookies_file"]))
            cookie_paths.append(self._cookies_file)

        def initiate_weblogin(self) -> None:
            pass

        def complete_weblogin(self, code: str) -> None:
            if complete_side_effect is not None:
                raise complete_side_effect
            self._cookies_file.write_text("cookie-jar")

    monkeypatch.setattr(target=module, name="TradeRepublicApi", value=_FakeApi)
    return cookie_paths


def test_start_and_complete_roundtrip_returns_cookies_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    cookie_paths = _patch_successful_client(monkeypatch)

    token, expires_at = module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)
    assert expires_at > utc_now()

    cookies = module.complete(challenge_token=token, credential_id=1, code=TWO_FACTOR_CODE)

    assert cookies == "cookie-jar"
    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
    assert_log_contains(
        caplog,
        messages=["2FA challenge issued for credential 1", "2FA login completed for credential 1"],
    )


def test_complete_rejects_unknown_token(caplog: pytest.LogCaptureFixture):
    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token="no-such-token", credential_id=1, code=TWO_FACTOR_CODE)  # nosec B106

    assert_log_contains(caplog, message="Unknown or expired 2FA challenge")


def test_complete_rejects_token_issued_for_other_credential(monkeypatch: pytest.MonkeyPatch):
    _patch_successful_client(monkeypatch)
    token, _ = module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=2, code=TWO_FACTOR_CODE)


def test_complete_translates_http_error_into_invalid_two_factor(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    cookie_paths = _patch_successful_client(monkeypatch, complete_side_effect=_http_error(400))
    token, _ = module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)

    with pytest.raises(InvalidTwoFactorError, match="Invalid 2FA code"):
        module.complete(challenge_token=token, credential_id=1, code=PIN)

    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
    assert_log_contains(caplog, message="Invalid 2FA code for credential 1")


def test_expired_challenge_is_cleaned_up_and_rejected(monkeypatch: pytest.MonkeyPatch):
    cookie_paths = _patch_successful_client(monkeypatch)
    token, _ = module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)
    module._pending_logins[token].expires_at = utc_now() - timedelta(seconds=1)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=1, code=TWO_FACTOR_CODE)

    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
