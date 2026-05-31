from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider
from source.backend.bank_handlers import fints_handler as module
from source.backend.bank_handlers.base import BankInfo
from source.backend.bank_handlers.fints_handler import (
    FinTSHandler,
    _resolve_decoupled,
    _try_configure_pushtan_mechanism,
)
from source.backend.exceptions import (
    InvalidCredentialsError,
    ReauthenticationRequiredError,
)


@dataclass
class _FakeMechanism:
    name: str
    description_required: str | None = None


def _ing_handler() -> FinTSHandler:
    bank_info = BANKS_BY_NAME[BankProvider.ING.value]
    return FinTSHandler(bank_info=bank_info, credentials={"username": "u", "password": "p"})  # nosec B105


def _sparkasse_handler(blz: str = "66050101") -> FinTSHandler:
    bank_info = BANKS_BY_NAME[BankProvider.SPARKASSE.value]
    credentials = {"blz": blz, "username": "u", "password": "p"}  # nosec B105
    return FinTSHandler(bank_info=bank_info, credentials=credentials)


def test_credential_fields_omit_blz_when_bank_identifier_is_pinned() -> None:
    bank_info = BANKS_BY_NAME[BankProvider.ING.value]
    assert FinTSHandler.credential_fields(bank_info) == ("username", "password")


def test_credential_fields_include_blz_when_bank_identifier_is_missing() -> None:
    bank_info = BANKS_BY_NAME[BankProvider.SPARKASSE.value]
    assert FinTSHandler.credential_fields(bank_info) == ("username", "password", "blz")


def test_client_uses_pinned_bank_identifier_and_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_fints_client(**kwargs: object) -> object:
        captured.update(kwargs)
        return MagicMock(name="FinTS3PinTanClient")

    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=fake_fints_client)
    monkeypatch.setattr(
        target=module,
        name="fints_url",
        value=MagicMock(find=MagicMock(side_effect=AssertionError("should not be called"))),
    )

    _ing_handler().client(user_id="user", pin="pin")

    assert captured["bank_identifier"] == "50010517"
    assert captured["server"] == "https://fints.ing.de/fints/"


def test_client_resolves_blz_and_url_for_unpinned_bank(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_fints_client(**kwargs: object) -> object:
        captured.update(kwargs)
        return MagicMock()

    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=fake_fints_client)
    monkeypatch.setattr(
        target=module, name="fints_url", value=MagicMock(find=lambda bank_code: f"https://lookup/{bank_code}")
    )

    _sparkasse_handler(blz="66050101").client(user_id="user", pin="pin")

    assert captured["bank_identifier"] == "66050101"
    assert captured["server"] == "https://lookup/66050101"


def test_client_raises_invalid_credentials_for_unknown_blz(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(bank_code: str) -> str:
        raise Exception(f"FinTS URL not found for {bank_code}")

    monkeypatch.setattr(target=module, name="fints_url", value=MagicMock(find=boom))

    with pytest.raises(InvalidCredentialsError, match="No FinTS server known for BLZ 99999999"):
        _sparkasse_handler(blz="99999999").client(user_id="u", pin="p")


def test_configure_pushtan_picks_mechanism_by_name() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {
        "900": _FakeMechanism(name="iTAN"),
        "942": _FakeMechanism(name="S-pushTAN"),
        "910": _FakeMechanism(name="chipTAN"),
    }

    _try_configure_pushtan_mechanism(client)

    client.fetch_tan_mechanisms.assert_called_once_with()
    client.set_tan_mechanism.assert_called_once_with("942")
    client.get_tan_media.assert_not_called()


def test_configure_pushtan_skips_silently_when_no_pushtan_advertised() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {"900": _FakeMechanism(name="iTAN")}

    _try_configure_pushtan_mechanism(client)

    client.set_tan_mechanism.assert_not_called()
    client.get_tan_media.assert_not_called()


def test_configure_pushtan_skips_silently_when_no_mechanisms_at_all() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {}

    _try_configure_pushtan_mechanism(client)

    client.set_tan_mechanism.assert_not_called()


def test_configure_pushtan_selects_tan_medium_when_required() -> None:
    medium = object()
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {
        "942": _FakeMechanism(name="pushTAN", description_required="MUST"),
    }
    client.get_tan_media.return_value = iter([medium])

    _try_configure_pushtan_mechanism(client)

    client.set_tan_medium.assert_called_once_with(medium)


def test_configure_pushtan_raises_when_medium_required_but_none_returned() -> None:
    client = MagicMock()
    client.get_tan_mechanisms.return_value = {
        "942": _FakeMechanism(name="pushTAN", description_required="MUST"),
    }
    client.get_tan_media.return_value = iter([])

    with pytest.raises(ReauthenticationRequiredError, match="requires a TAN medium"):
        _try_configure_pushtan_mechanism(client)


def test_resolve_decoupled_returns_input_when_no_tan_required() -> None:
    client = MagicMock()
    payload = object()

    result = _resolve_decoupled(client=client, response=payload)

    assert result is payload
    client.send_tan.assert_not_called()


def test_resolve_decoupled_polls_until_resolved(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr(target=module, name="sleep", value=lambda seconds: sleeps.append(seconds))

    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = True
    final_response = ["actual", "transactions"]

    client = MagicMock()
    # First two polls still pending, third returns the final payload.
    client.send_tan.side_effect = [pending, pending, final_response]

    result = _resolve_decoupled(client=client, response=pending)

    assert result is final_response
    assert client.send_tan.call_count == 3
    assert sleeps == [module.APPROVAL_POLL_INTERVAL.total_seconds()] * 3


def test_resolve_decoupled_invokes_notifier_on_enter_and_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(target=module, name="sleep", value=lambda _: None)
    calls: list[bool] = []

    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = True

    client = MagicMock()
    client.send_tan.return_value = "done"

    _resolve_decoupled(client=client, response=pending, notify_two_factor_state=calls.append)

    assert calls == [True, False]


def test_resolve_decoupled_notifies_false_even_when_polling_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(target=module, name="sleep", value=lambda _: None)
    fake_time = iter([0.0, 0.0, module.APPROVAL_TIMEOUT.total_seconds() + 1])
    monkeypatch.setattr(target=module.time, name="monotonic", value=lambda: next(fake_time))

    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = True
    client = MagicMock()
    client.send_tan.return_value = pending
    calls: list[bool] = []

    with pytest.raises(ReauthenticationRequiredError, match="did not arrive within"):
        _resolve_decoupled(client=client, response=pending, notify_two_factor_state=calls.append)

    assert calls == [True, False]


def test_resolve_decoupled_raises_when_non_decoupled() -> None:
    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = False
    client = MagicMock()

    with pytest.raises(ReauthenticationRequiredError, match="non-decoupled"):
        _resolve_decoupled(client=client, response=pending)


def test_session_resolves_tan_responses_from_get_transactions(monkeypatch: pytest.MonkeyPatch) -> None:
    # Sparkasse triggers a second TAN prompt on get_transactions (PSD2 for old reads).
    # Verify the session unwraps NeedTANResponse and polls until the bank returns data.
    monkeypatch.setattr(target=module, name="sleep", value=lambda _: None)

    pending = MagicMock(spec=module.NeedTANResponse)
    pending.decoupled = True

    fake_transaction = MagicMock()
    fake_transaction.data = {"amount": MagicMock(amount=1.0), "purpose": "x", "date": MagicMock()}

    client = MagicMock()
    client.get_transactions.return_value = pending
    # After 2 polls, the bank returns the actual transactions iterable.
    client.send_tan.side_effect = [pending, [fake_transaction]]

    session = module._FinTSSession(client=client)
    session._account_mapping = {"DE00 1234": MagicMock()}

    # We don't care about the parsed values here, just that the call doesn't raise
    # 'NeedTANResponse object is not iterable'.
    from datetime import date

    transactions = session.get_transactions(
        account=module.FetchedAccount(name="DE00 1234"), start_date=date(year=2025, month=1, day=1)
    )

    assert len(transactions) == 1
    assert client.send_tan.call_count == 2


def test_session_translates_missing_system_id_into_invalid_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    # python-fints raises a bare ValueError('Could not find system_id') when the bank rejects
    # the login (wrong username/PIN), because the initial sync can't obtain a system id.
    client = MagicMock()
    client.fetch_tan_mechanisms.side_effect = ValueError("Could not find system_id")
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=lambda **kwargs: client)

    with pytest.raises(InvalidCredentialsError):
        with _ing_handler().session():
            pass


def test_session_translates_fints_pin_error_into_invalid_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    from fints.exceptions import FinTSClientPINError

    client = MagicMock()
    client.fetch_tan_mechanisms.side_effect = FinTSClientPINError("PIN is wrong or blocked")
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=lambda **kwargs: client)

    with pytest.raises(InvalidCredentialsError):
        with _ing_handler().session():
            pass


def test_session_does_not_swallow_unrelated_value_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only the system_id failure means "bad credentials"; other ValueErrors must surface as-is.
    client = MagicMock()
    client.fetch_tan_mechanisms.side_effect = ValueError("something else entirely")
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=lambda **kwargs: client)

    with pytest.raises(ValueError, match="something else entirely"):
        with _ing_handler().session():
            pass


def test_sparkasse_strips_whitespace_from_blz() -> None:
    rules = BANKS_BY_NAME[BankProvider.SPARKASSE.value].information_for_user["field_rules"]

    assert rules["blz"]["strip_whitespace"] is True
    assert rules["blz"]["rules"] == []


def test_bank_info_required_fields_reflects_handler_credential_fields() -> None:
    sparkasse: BankInfo = BANKS_BY_NAME[BankProvider.SPARKASSE.value]
    ing: BankInfo = BANKS_BY_NAME[BankProvider.ING.value]
    assert sparkasse.required_fields == ["username", "password", "blz"]
    assert ing.required_fields == ["username", "password"]
