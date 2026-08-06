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


@pytest.mark.parametrize(
    argnames=("initiate_side_effect", "expected_exception", "expected_log"),
    argvalues=[
        # Trade Republic answers 400 to the weblogin when the phone number / PIN is wrong.
        (
            _http_error(400),
            InvalidCredentialsError,
            ["Initiating Trade Republic web login", "Trade Republic rejected the login"],
        ),
        (
            ValueError("bad phone number"),
            InvalidCredentialsError,
            ["Trade Republic rejected the login for credential 1"],
        ),
        (_http_error(503), requests.exceptions.HTTPError, []),  # server errors are re-raised generically
        (_http_error(429), BankRateLimitedError, ["Trade Republic rate limited the login for credential 1"]),
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
        module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)

    if expected_log:
        assert_log_contains(caplog, messages=expected_log)


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

        def _await_weblogin_confirmation(self) -> None:  # app tap after the code
            pass

        def save_websession(self) -> None:
            pass

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


@pytest.mark.parametrize(
    argnames=("message", "expected_exception"),
    argvalues=[
        ("That authenticator code is not correct.", InvalidTwoFactorError),
        ("Too many attempts. Please wait before trying again.", BankRateLimitedError),
    ],
)
def test_complete_maps_value_errors(monkeypatch: pytest.MonkeyPatch, message: str, expected_exception: type[Exception]):
    cookie_paths = _patch_successful_client(monkeypatch, complete_side_effect=ValueError(message))
    token, _ = module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)

    with pytest.raises(expected_exception):
        module.complete(challenge_token=token, credential_id=1, code=TWO_FACTOR_CODE)

    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()


def test_await_app_confirmation_brackets_the_wait_with_two_factor_state():
    calls: list[object] = []

    class _FakeApi:
        def _await_weblogin_confirmation(self) -> None:
            calls.append("wait")

        def save_websession(self) -> None:
            calls.append("save")

    module.await_app_confirmation(client=_FakeApi(), notify_two_factor_state=calls.append)

    # True (spinner on) -> poll for the app tap -> persist -> False (spinner off)
    assert calls == [True, "wait", "save", False]


def test_await_app_confirmation_clears_state_even_when_wait_fails():
    calls: list[object] = []

    class _FakeApi:
        def _await_weblogin_confirmation(self) -> None:
            raise RuntimeError("boom")

        def save_websession(self) -> None:
            calls.append("save")

    with pytest.raises(RuntimeError):
        module.await_app_confirmation(client=_FakeApi(), notify_two_factor_state=calls.append)

    assert calls == [True, False]


def test_expired_challenge_is_cleaned_up_and_rejected(monkeypatch: pytest.MonkeyPatch):
    cookie_paths = _patch_successful_client(monkeypatch)
    token, _ = module.start(credential_id=1, phone_no=PHONE_NUMBER, pin=PIN)
    module._pending_logins[token].expires_at = utc_now() - timedelta(seconds=1)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=1, code=TWO_FACTOR_CODE)

    assert module._pending_logins == {}
    assert not cookie_paths[0].exists()
