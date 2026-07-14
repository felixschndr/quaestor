import pytest
import requests

from source.backend.exceptions import InvalidCredentialsError
from source.backend.services.banking import trade_republic_login as module
from tests.backend.conftest import assert_log_contains


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
        module.start(credential_id=1, phone_no="+490000000000", pin="0000")

    assert_log_contains(caplog, messages=["Initiating Trade Republic web login", "Trade Republic rejected the login"])


def test_start_translates_value_error_into_invalid_credentials(monkeypatch: pytest.MonkeyPatch):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=ValueError("bad phone number"))

    with pytest.raises(InvalidCredentialsError):
        module.start(credential_id=1, phone_no="nonsense", pin="0000")


def test_start_reraises_server_errors_as_generic(monkeypatch: pytest.MonkeyPatch):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=_http_error(503))

    with pytest.raises(requests.exceptions.HTTPError):
        module.start(credential_id=1, phone_no="+490000000000", pin="0000")


def test_start_reraises_rate_limit_as_generic(monkeypatch: pytest.MonkeyPatch):
    _patch_client(monkeypatch=monkeypatch, initiate_side_effect=_http_error(429))

    with pytest.raises(requests.exceptions.HTTPError):
        module.start(credential_id=1, phone_no="+490000000000", pin="0000")
