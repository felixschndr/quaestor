from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider
from source.backend.bank_handlers import fints_handler as module
from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankInfo,
    FetchedAccount,
)
from source.backend.bank_handlers.fints_handler import (
    FinTSHandler,
    _resolve_decoupled,
    _try_configure_pushtan_mechanism,
)
from source.backend.exceptions import (
    InvalidCredentialsError,
    ReauthenticationRequiredError,
)

from tests.backend.conftest import (
    ACCOUNT_IBAN,
    BANK_PASSWORD,
    BANK_USERNAME,
    CHALLENGE_TOKEN,
    LAST_FETCHING_TIMESTAMP,
    PIN,
    RECENT_DATE,
    SECOND_ACCOUNT_IBAN,
)


@dataclass
class _FakeMechanism:
    name: str
    description_required: str | None = None


_FAKE_BANK_INFO = BankInfo(
    name="pinned",
    handler=FinTSHandler,
    bank_identifier="50010517",
    fints_url="https://fints.ing.de/fints/",
)


def _fints_handler(blz: str = "66050101") -> FinTSHandler:
    bank_info = BANKS_BY_NAME[BankProvider.FINTS.value]
    credentials = {"username": BANK_USERNAME, "password": BANK_PASSWORD, "blz": blz}
    return FinTSHandler(bank_info=bank_info, credentials=credentials)


def test_credential_fields_omit_blz_when_bank_identifier_is_pinned() -> None:
    assert FinTSHandler.credential_fields(_FAKE_BANK_INFO) == ("username", "password")


def test_credential_fields_include_blz_when_bank_identifier_is_missing() -> None:
    bank_info = BANKS_BY_NAME[BankProvider.FINTS.value]
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

    FinTSHandler(bank_info=_FAKE_BANK_INFO, credentials={"username": BANK_USERNAME, "password": BANK_PASSWORD}).client(
        user_id=BANK_USERNAME, pin=PIN
    )

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

    _fints_handler(blz="66050101").client(user_id=BANK_USERNAME, pin=PIN)

    assert captured["bank_identifier"] == "66050101"
    assert captured["server"] == "https://lookup/66050101"


def test_client_raises_invalid_credentials_for_unknown_blz(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(bank_code: str) -> str:
        raise Exception(f"FinTS URL not found for {bank_code}")

    monkeypatch.setattr(target=module, name="fints_url", value=MagicMock(find=boom))

    with pytest.raises(InvalidCredentialsError, match="No FinTS server known for BLZ 99999999"):
        _fints_handler(blz="99999999").client(user_id=BANK_USERNAME, pin=PIN)


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
    # get_transactions runs twice per call (booked-only + booked+pending)
    client.send_tan.side_effect = [pending, [fake_transaction], pending, [fake_transaction]]

    session = module._FinTSSession(client=client)
    session._account_mapping = {ACCOUNT_IBAN: MagicMock()}

    # We don't care about the parsed values here, just that the call doesn't raise
    # 'NeedTANResponse object is not iterable'.

    transactions = session.get_transactions(account=module.FetchedAccount(name=ACCOUNT_IBAN), start_date=RECENT_DATE)

    assert len(transactions) == 1
    assert client.get_transactions.call_count == 2
    assert client.send_tan.call_count == 4


def test_parse_camt_if_needed_passes_non_tuple_through_unchanged() -> None:
    # The mt940 path already hands us a parsed Transaction list; it must be returned as-is.
    parsed = [MagicMock()]
    assert module._parse_camt_if_needed(parsed, include_pending=True) is parsed


def test_parse_camt_if_needed_parses_booked_only_when_pending_excluded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(target=module, name="camt053_to_dict", value=lambda stream: [{"stream": stream}])

    result = module._parse_camt_if_needed(([b"booked"], [b"pending"]), include_pending=False)

    assert [transaction.data for transaction in result] == [{"stream": b"booked"}]


def test_parse_camt_if_needed_includes_pending_and_skips_none_streams(monkeypatch: pytest.MonkeyPatch) -> None:
    # The bank reports a None pending stream when there is nothing pending; camt053_to_dict(None)
    # would crash, so _parse_camt_if_needed must skip it while still including real pending streams.
    monkeypatch.setattr(target=module, name="camt053_to_dict", value=lambda stream: [{"stream": stream}])

    result = module._parse_camt_if_needed(([b"booked"], [None, b"pending"]), include_pending=True)

    assert [transaction.data for transaction in result] == [{"stream": b"booked"}, {"stream": b"pending"}]


def test_session_uses_camt_xml_for_banks_without_mt940(monkeypatch: pytest.MonkeyPatch) -> None:
    # e.g. Volksbank
    monkeypatch.setattr(target=module, name="sleep", value=lambda _: None)
    monkeypatch.setattr(
        target=module,
        name="camt053_to_dict",
        value=lambda stream: [{"amount": MagicMock(amount=1.0), "purpose": "x", "date": RECENT_DATE}],
    )

    client = MagicMock()
    client.bpd.find_segment_first.return_value = None  # no HIKAZS -> CAMT-only bank
    client.get_transactions_xml.return_value = ([b"<booked/>"], [None])

    session = module._FinTSSession(client=client)
    session._account_mapping = {ACCOUNT_IBAN: MagicMock(iban=ACCOUNT_IBAN)}

    transactions = session.get_transactions(account=module.FetchedAccount(name=ACCOUNT_IBAN), start_date=RECENT_DATE)

    assert client.get_transactions_xml.call_count == 2
    assert client.get_transactions.call_count == 0
    assert len(transactions) == 1
    assert transactions[0].pending is False


def test_session_translates_missing_system_id_into_invalid_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    # python-fints raises a bare ValueError('Could not find system_id') when the bank rejects
    # the login (wrong username/PIN), because the initial sync can't obtain a system id.
    client = MagicMock()
    client.fetch_tan_mechanisms.side_effect = ValueError("Could not find system_id")
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=lambda **kwargs: client)

    with pytest.raises(InvalidCredentialsError):
        with _fints_handler().session():
            pass


def test_session_translates_fints_pin_error_into_invalid_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    from fints.exceptions import FinTSClientPINError

    client = MagicMock()
    client.fetch_tan_mechanisms.side_effect = FinTSClientPINError("PIN is wrong or blocked")
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=lambda **kwargs: client)

    with pytest.raises(InvalidCredentialsError):
        with _fints_handler().session():
            pass


def test_session_does_not_swallow_unrelated_value_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only the system_id failure means "bad credentials"; other ValueErrors must surface as-is.
    client = MagicMock()
    client.fetch_tan_mechanisms.side_effect = ValueError("something else entirely")
    monkeypatch.setattr(target=module, name="FinTS3PinTanClient", value=lambda **kwargs: client)

    with pytest.raises(ValueError, match="something else entirely"):
        with _fints_handler().session():
            pass


def test_fints_strips_whitespace_from_blz() -> None:
    rules = BANKS_BY_NAME[BankProvider.FINTS.value].information_for_user["field_rules"]

    assert rules["blz"]["strip_whitespace"] is True
    assert rules["blz"]["rules"] == []


def test_bank_info_required_fields_reflects_handler_credential_fields() -> None:
    fints = BANKS_BY_NAME[BankProvider.FINTS.value]
    assert fints.required_fields == ["username", "password", "blz"]
    assert _FAKE_BANK_INFO.required_fields == ["username", "password"]


def test_fints_handler_offers_no_out_of_band_two_factor_challenge() -> None:
    assert _fints_handler().begin_two_factor_challenge(credential_id=1) is None


def test_fints_handler_complete_two_factor_challenge_is_not_supported() -> None:
    with pytest.raises(NotImplementedError):
        _fints_handler().complete_two_factor_challenge(challenge_token=CHALLENGE_TOKEN, credential_id=1, code="0000")


@dataclass
class _FakeMt940Amount:
    amount: Decimal


@dataclass
class _FakeMt940Balance:
    amount: _FakeMt940Amount | None
    date: date | None


def _fake_raw_statement(balances: dict[str, _FakeMt940Balance]) -> list[MagicMock]:
    # python-fints hands back mt940 Transaction objects whose `.transactions` back-reference carries
    # the statement-level `.data` dict with the opening/closing balances.
    collection = MagicMock()
    collection.data = balances
    transaction = MagicMock()
    transaction.transactions = collection
    return [transaction]


def test_extract_balance_observations_reads_opening_balance_and_ignores_closing() -> None:
    raw = _fake_raw_statement(
        {
            "final_opening_balance": _FakeMt940Balance(amount=_FakeMt940Amount(Decimal("625.15")), date=RECENT_DATE),
            "final_closing_balance": _FakeMt940Balance(
                amount=_FakeMt940Amount(Decimal("700.00")), date=LAST_FETCHING_TIMESTAMP.date()
            ),
        }
    )

    observations = module._extract_balance_observations(raw)

    assert [(observation.date, observation.amount) for observation in observations] == [
        (RECENT_DATE, 625.15),
    ]


def test_extract_balance_observations_returns_empty_for_empty_statement() -> None:
    assert module._extract_balance_observations([]) == []


def test_extract_balance_observations_skips_incomplete_balances() -> None:
    raw = _fake_raw_statement(
        {"final_opening_balance": _FakeMt940Balance(amount=_FakeMt940Amount(Decimal("10")), date=None)}
    )

    assert module._extract_balance_observations(raw) == []


def test_get_balance_observations_returns_captured_anchors_for_account() -> None:
    session = module._FinTSSession(client=MagicMock())
    sepa_account = MagicMock(iban=ACCOUNT_IBAN)
    session._account_mapping = {ACCOUNT_IBAN: sepa_account}
    anchors = [BalanceObservation(date=RECENT_DATE, amount=625.15)]
    session._balance_observations = {ACCOUNT_IBAN: anchors}

    assert session.get_balance_observations(FetchedAccount(name=ACCOUNT_IBAN)) == anchors
    assert session.get_balance_observations(FetchedAccount(name=SECOND_ACCOUNT_IBAN)) == []


def _fake_mt940_transaction(amount: float, txn_date: date, opening: _FakeMt940Balance | None) -> MagicMock:
    collection = MagicMock()
    collection.data = {"final_opening_balance": opening} if opening is not None else {}
    transaction = MagicMock()
    transaction.transactions = collection
    transaction.data = {
        "amount": _FakeMt940Amount(Decimal(str(amount))),
        "date": txn_date,
        "purpose": "purpose",
        "applicant_name": "party",
    }
    return transaction


def _session_with_mapped_account() -> "module._FinTSSession":
    session = module._FinTSSession(client=MagicMock())
    session._account_mapping = {ACCOUNT_IBAN: MagicMock(iban=ACCOUNT_IBAN)}
    return session


def _statement_with_opening(amount: float, txn_day: date, opening_balance: float, opening_day: date) -> list[MagicMock]:
    opening = _FakeMt940Balance(amount=_FakeMt940Amount(Decimal(str(opening_balance))), date=opening_day)
    return [_fake_mt940_transaction(amount=amount, txn_date=txn_day, opening=opening)]


def test_get_transactions_accumulates_opening_anchor_from_both_fetches() -> None:
    session = _session_with_mapped_account()
    booked_opening_day = LAST_FETCHING_TIMESTAMP.date()
    booked = _statement_with_opening(
        amount=-10.0, txn_day=booked_opening_day, opening_balance=100.0, opening_day=booked_opening_day
    )
    pending = _statement_with_opening(amount=-20.0, txn_day=RECENT_DATE, opening_balance=300.0, opening_day=RECENT_DATE)
    session._client.get_transactions.side_effect = [booked, pending]

    session.get_transactions(account=FetchedAccount(name=ACCOUNT_IBAN), start_date=booked_opening_day)

    observations = session.get_balance_observations(FetchedAccount(name=ACCOUNT_IBAN))
    assert [(observation.date, observation.amount) for observation in observations] == [
        (booked_opening_day, 100.0),
        (RECENT_DATE, 300.0),
    ]


def test_get_transactions_resets_anchors_between_calls() -> None:
    # Two get_transactions calls (e.g. two syncs) must not let anchors pile up across calls.
    session = _session_with_mapped_account()
    statement = _statement_with_opening(
        amount=-10.0, txn_day=RECENT_DATE, opening_balance=100.0, opening_day=RECENT_DATE
    )
    session._client.get_transactions.side_effect = [statement, [], statement, []]

    session.get_transactions(account=FetchedAccount(name=ACCOUNT_IBAN), start_date=RECENT_DATE)
    session.get_transactions(account=FetchedAccount(name=ACCOUNT_IBAN), start_date=RECENT_DATE)

    assert len(session.get_balance_observations(FetchedAccount(name=ACCOUNT_IBAN))) == 1
