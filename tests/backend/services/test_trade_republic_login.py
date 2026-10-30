from datetime import timedelta
from pathlib import Path

import pytest
import requests
from pytr.api import TradeRepublicApi

from source.backend.exceptions import (
    BankRateLimitedError,
    InvalidCredentialsError,
    InvalidTwoFactorError,
)
from source.backend.helpers import utc_now
from source.backend.services.banking import trade_republic_login as module
from tests.backend.conftest import (
    CREDENTIAL_ID,
    PHONE_NUMBER,
    PIN,
    SECOND_CREDENTIAL_ID,
    TRADE_REPUBLIC_ERROR_BODY,
    TWO_FACTOR_CODE,
    assert_log_contains,
)


@pytest.fixture(autouse=True)
def isolate_pending_logins(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=module, name="_pending_logins", value={})


def _http_error(status_code: int, body: str = "") -> requests.exceptions.HTTPError:
    response = requests.Response()
    response.status_code = status_code
    response._content = body.encode()
    return requests.exceptions.HTTPError(f"{status_code} Client Error", response=response)


def _patch_client(monkeypatch: pytest.MonkeyPatch, initiate_side_effect: Exception) -> None:
    class _FakeApi(TradeRepublicApi):
        def initiate_weblogin(self) -> None:
            raise initiate_side_effect

    monkeypatch.setattr(target=module, name="TradeRepublicApi", value=_FakeApi)


@pytest.mark.parametrize(
    argnames=("initiate_side_effect", "expected_exception", "expected_log"),
    argvalues=[
        # Trade Republic answers 400 to the weblogin when the phone number / PIN is wrong.
        (
            _http_error(400, body=TRADE_REPUBLIC_ERROR_BODY),
            InvalidCredentialsError,
            [
                "Initiating Trade Republic web login",
                f"Trade Republic rejected the login for credential {CREDENTIAL_ID}: 400 Client Error"
                f" | response: {TRADE_REPUBLIC_ERROR_BODY}",
            ],
        ),
        (
            ValueError("bad phone number"),
            InvalidCredentialsError,
            [f"Trade Republic rejected the login for credential {CREDENTIAL_ID}"],
        ),
        (_http_error(503), requests.exceptions.HTTPError, []),  # server errors are re-raised generically
        (
            _http_error(429, body=TRADE_REPUBLIC_ERROR_BODY),
            BankRateLimitedError,
            [
                f"Trade Republic rate limited the login for credential {CREDENTIAL_ID}"
                f" | response: {TRADE_REPUBLIC_ERROR_BODY}"
            ],
        ),
    ],
)
def test_start_translates_initiate_errors(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    initiate_side_effect: Exception,
    expected_exception: type[Exception],
    expected_log: list[str],
):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=initiate_side_effect)

    with pytest.raises(expected_exception):
        module.start(credential_id=CREDENTIAL_ID, phone_no=PHONE_NUMBER, pin=PIN)

    if expected_log:
        assert_log_contains(caplog, messages=expected_log)


def _patch_successful_client(
    monkeypatch: pytest.MonkeyPatch, complete_side_effect: Exception | None = None
) -> list[Path]:
    cookie_paths: list[Path] = []

    class _FakeApi(TradeRepublicApi):
        def __init__(self, **kwargs: object) -> None:
            super().__init__(**kwargs)
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

    token, expires_at = module.start(credential_id=CREDENTIAL_ID, phone_no=PHONE_NUMBER, pin=PIN)
    assert expires_at > utc_now()
    login_headers = module._pending_logins[token].trade_republic_client._websession.headers
    assert {"X-TR-Device-Info", "X-TR-App-Version", "X-Tr-Platform"} <= login_headers.keys()
    assert "X-TR-App-Version" not in TradeRepublicApi._default_headers

    cookies = module.complete(challenge_token=token, credential_id=CREDENTIAL_ID, code=TWO_FACTOR_CODE)

    assert cookies == "cookie-jar"
    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
    assert_log_contains(
        caplog,
        messages=[
            f"2FA challenge issued for credential {CREDENTIAL_ID}",
            f"2FA login completed for credential {CREDENTIAL_ID}",
        ],
    )


def test_complete_rejects_unknown_token(caplog: pytest.LogCaptureFixture):
    with pytest.raises(InvalidTwoFactorError):
        module.complete(
            challenge_token="no-such-token", credential_id=CREDENTIAL_ID, code=TWO_FACTOR_CODE
        )  # nosec B106

    assert_log_contains(caplog, message="Unknown or expired 2FA challenge")


def test_complete_rejects_token_issued_for_other_credential(monkeypatch: pytest.MonkeyPatch):
    _patch_successful_client(monkeypatch)
    token, _ = module.start(credential_id=CREDENTIAL_ID, phone_no=PHONE_NUMBER, pin=PIN)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=SECOND_CREDENTIAL_ID, code=TWO_FACTOR_CODE)


def test_complete_translates_http_error_into_invalid_two_factor(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    cookie_paths = _patch_successful_client(
        monkeypatch, complete_side_effect=_http_error(400, body=TRADE_REPUBLIC_ERROR_BODY)
    )
    token, _ = module.start(credential_id=CREDENTIAL_ID, phone_no=PHONE_NUMBER, pin=PIN)

    with pytest.raises(InvalidTwoFactorError, match="Invalid 2FA code"):
        module.complete(challenge_token=token, credential_id=CREDENTIAL_ID, code=PIN)

    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
    assert_log_contains(
        caplog,
        message=f"Invalid 2FA code for credential {CREDENTIAL_ID}: 400 Client Error"
        f" | response: {TRADE_REPUBLIC_ERROR_BODY}",
    )


@pytest.mark.parametrize(
    argnames="complete_side_effect, expected_exception, expected_log",
    argvalues=[
        (
            ValueError("Too many requests"),
            BankRateLimitedError,
            f"Trade Republic rate limited the login for credential {CREDENTIAL_ID}",
        ),
        (
            ValueError("code mismatch"),
            InvalidTwoFactorError,
            f"Invalid 2FA code for credential {CREDENTIAL_ID}: code mismatch",
        ),
    ],
)
def test_complete_translates_value_errors(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    complete_side_effect: Exception,
    expected_exception: type[Exception],
    expected_log: str,
):
    cookie_paths = _patch_successful_client(monkeypatch, complete_side_effect=complete_side_effect)
    token, _ = module.start(credential_id=CREDENTIAL_ID, phone_no=PHONE_NUMBER, pin=PIN)

    with pytest.raises(expected_exception):
        module.complete(challenge_token=token, credential_id=CREDENTIAL_ID, code=TWO_FACTOR_CODE)

    assert not cookie_paths[0].exists()
    assert_log_contains(caplog, message=expected_log)


def test_expired_challenge_is_cleaned_up_and_rejected(monkeypatch: pytest.MonkeyPatch):
    cookie_paths = _patch_successful_client(monkeypatch)
    token, _ = module.start(credential_id=CREDENTIAL_ID, phone_no=PHONE_NUMBER, pin=PIN)
    module._pending_logins[token].expires_at = utc_now() - timedelta(seconds=1)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=CREDENTIAL_ID, code=TWO_FACTOR_CODE)

    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
