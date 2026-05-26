from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider
from source.backend.bank_handlers import sparkasse_handler as module
from source.backend.bank_handlers.sparkasse_handler import (
    SparkasseHandler,
    _configure_pushtan_mechanism,
    _wait_for_decoupled_approval,
)
from source.backend.exceptions import (
    InvalidCredentialsError,
    ReauthenticationRequiredError,
)


@dataclass
class _FakeMechanism:
    name: str
    description_required: str | None = None


def _handler(credentials: dict[str, str] | None = None) -> SparkasseHandler:
    bank_info = BANKS_BY_NAME[BankProvider.SPARKASSE.value]
    return SparkasseHandler(
        bank_info=bank_info,
        credentials=credentials or {"blz": "66050101", "username": "u", "password": "p"},  # nosec B105
    )


def test_credential_fields_include_blz() -> None:
    assert SparkasseHandler.CREDENTIAL_FIELDS == ("blz", "username", "password")


def test_client_resolves_fints_url_from_blz(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_fints_client(**kwargs: object) -> object:
        captured.update(kwargs)
        return MagicMock(name="FinTS3PinTanClient")

    monkeypatch.setattr(
        target=module, name="fints_url", value=MagicMock(find=lambda bank_code: "https://example/fints")
    )
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=fake_fints_client)

    _handler().client(user_id="user", pin="pin")

    assert captured["bank_identifier"] == "66050101"
    assert captured["server"] == "https://example/fints"
    assert captured["user_id"] == "user"
    assert captured["pin"] == "pin"


def test_client_raises_invalid_credentials_for_unknown_blz(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(bank_code: str) -> str:
        raise Exception(f"FinTS URL not found for {bank_code}")

    monkeypatch.setattr(target=module, name="fints_url", value=MagicMock(find=boom))

    credentials = {"blz": "99999999", "username": "u", "password": "p"}  # nosec B105
    with pytest.raises(InvalidCredentialsError, match="No FinTS server known for BLZ 99999999"):
        _handler(credentials).client(user_id="u", pin="p")


def test_configure_pushtan_picks_mechanism_by_name() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {
        "900": _FakeMechanism(name="iTAN"),
        "942": _FakeMechanism(name="S-pushTAN"),
        "910": _FakeMechanism(name="chipTAN"),
    }

    _configure_pushtan_mechanism(client)

    client.fetch_tan_mechanisms.assert_called_once_with()
    client.set_tan_mechanism.assert_called_once_with("942")
    client.get_tan_media.assert_not_called()


def test_configure_pushtan_raises_if_no_pushtan_advertised() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {"900": _FakeMechanism(name="iTAN")}

    with pytest.raises(ReauthenticationRequiredError, match="did not advertise a pushTAN mechanism"):
        _configure_pushtan_mechanism(client)


def test_configure_pushtan_selects_tan_medium_when_required() -> None:
    medium = object()
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {
        "942": _FakeMechanism(name="pushTAN", description_required="MUST"),
    }
    client.get_tan_media.return_value = iter([medium])

    _configure_pushtan_mechanism(client)

    client.set_tan_medium.assert_called_once_with(medium)


def test_configure_pushtan_raises_when_medium_required_but_none_returned() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {
        "942": _FakeMechanism(name="pushTAN", description_required="MUST"),
    }
    client.get_tan_media.return_value = iter([])

    with pytest.raises(ReauthenticationRequiredError, match="requires a TAN medium"):
        _configure_pushtan_mechanism(client)


def test_wait_returns_immediately_when_no_tan_required() -> None:
    client = MagicMock()
    client.init_tan_response = object()  # not a NeedTANResponse

    _wait_for_decoupled_approval(client)

    client.send_tan.assert_not_called()


def test_wait_polls_until_approval(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr(target=module, name="sleep", value=lambda seconds: sleeps.append(seconds))

    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = True
    final_response = object()

    client = MagicMock()
    client.init_tan_response = pending
    # First two polls still pending, third returns the final non-TAN response.
    client.send_tan.side_effect = [pending, pending, final_response]

    _wait_for_decoupled_approval(client)

    assert client.send_tan.call_count == 3
    assert client.init_tan_response is final_response
    assert sleeps == [module.APPROVAL_POLL_INTERVAL_SECONDS] * 3


def test_wait_raises_when_non_decoupled(monkeypatch: pytest.MonkeyPatch) -> None:
    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = False

    client = MagicMock()
    client.init_tan_response = pending

    with pytest.raises(ReauthenticationRequiredError, match="non-decoupled"):
        _wait_for_decoupled_approval(client)


def test_wait_raises_on_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(target=module, name="sleep", value=lambda _: None)
    # Advance the monotonic clock so the deadline is exceeded on the first poll.
    fake_time = iter([0.0, 0.0, module.APPROVAL_TIMEOUT_SECONDS + 1])
    monkeypatch.setattr(target=module.time, name="monotonic", value=lambda: next(fake_time))

    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = True

    client = MagicMock()
    client.init_tan_response = pending
    client.send_tan.return_value = pending

    with pytest.raises(ReauthenticationRequiredError, match="did not arrive within"):
        _wait_for_decoupled_approval(client)
