import asyncio
import itertools
import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from source.backend.bank_handlers import BANKS_BY_NAME, scalable_capital
from source.backend.bank_handlers.base import FetchedAccount, TwoFactorChallenge
from source.backend.bank_handlers.scalable_capital import ScalableCapitalHandler, _ScalableCapitalSession
from source.backend.exceptions import ReauthenticationRequiredError
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.paths import SCALABLE_CLI_BIN
from source.backend.services.banking import scalable_capital_login
from tests.backend.conftest import (
    ACCOUNT_UID,
    AMOUNT,
    CHALLENGE_TOKEN,
    DEFAULT_AMOUNT,
    DEFAULT_BALANCE,
    ETF_NAME,
    ISIN,
    LATEST_DATE,
    OLDER_DATE,
    PORTFOLIO_ID,
    POSITION_NAME,
    RECENT_DATE,
    SCALABLE_AUTHORIZATION_URL,
    SECOND_ACCOUNT_UID,
    SECOND_AMOUNT,
    SECOND_ISIN,
    SECOND_SESSION_ARCHIVE,
    SESSION_ARCHIVE,
    THIRD_AMOUNT,
    TWO_FACTOR_CODE,
    assert_log_contains,
)

# All payloads below mirror the shapes the pinned `sc 1.0.0` binary really emits (captured by
# running the released binary directly against a live account). The envelope is
# `{ok, command, data}`; for every broker/overnight command except `broker chart`, `data` nests the
# projection under an extra `result` key alongside resolution metadata (`_run_command` unwraps this).

HOLDINGS_COMMAND = f"{SCALABLE_CLI_BIN} broker holdings --json"
CASH_ACCOUNT = FetchedAccount(name="Scalable Capital Verrechnungskonto")
OVERNIGHT_ACCOUNT = FetchedAccount(name="Scalable Capital Tagesgeld")

QUANTITY = 10.0
SECOND_QUANTITY = 20.0
SOLD_QUANTITY = 4.0
PRICES = {OLDER_DATE: 100.0, RECENT_DATE: 110.0, LATEST_DATE: 120.0}
SECOND_PRICES = {OLDER_DATE: 25.0, RECENT_DATE: 30.0}


def _event_datetime(day: date) -> str:
    return f"{day.isoformat()}T00:00:00.000Z"


CASH_BREAKDOWN_PAYLOAD = {
    "ok": True,
    "command": "broker.cash-breakdown",
    "data": {
        "account_id": ACCOUNT_UID,
        "portfolio_id": PORTFOLIO_ID,
        "resolution": {"account": "selected_context", "portfolio": "selected_context"},
        "result": {
            "account_id": ACCOUNT_UID,
            "portfolio_id": PORTFOLIO_ID,
            "cash_balance": DEFAULT_BALANCE,
            "buying_power": DEFAULT_BALANCE,
            "buying_power_without_credit": DEFAULT_BALANCE,
            "available_credit_line": 0,
            "loaned": 0,
            "pending_buy_orders_amount": 0,
            "possible_taxes": 0,
            "derivatives_buying_power": DEFAULT_BALANCE,
            "available_for_derivatives": DEFAULT_BALANCE,
        },
    },
}

HOLDINGS_PAYLOAD = {
    "ok": True,
    "command": "broker.holdings",
    "data": {
        "account_id": ACCOUNT_UID,
        "portfolio_id": PORTFOLIO_ID,
        "resolution": {"account": "selected_context", "portfolio": "selected_context"},
        "result": {
            "account_id": ACCOUNT_UID,
            "portfolio_id": PORTFOLIO_ID,
            "count": 2,
            "items": [
                {
                    "isin": ISIN,
                    "name": ETF_NAME,
                    "security_type": "STOCK",
                    "quantity": QUANTITY,
                    "pending_quantity": 0,
                    "blocked_quantity": 0,
                    "fifo_price": PRICES[RECENT_DATE],
                    "valuation": QUANTITY * PRICES[LATEST_DATE],
                    "valuation_currency": "EUR",
                    "quote_mid_price": PRICES[LATEST_DATE],
                    "quote_currency": "EUR",
                    "quote_timestamp_utc": _event_datetime(LATEST_DATE),
                    "quote_is_outdated": False,
                },
                {
                    "isin": SECOND_ISIN,
                    "name": POSITION_NAME,
                    "security_type": "STOCK",
                    "quantity": SECOND_QUANTITY,
                    "pending_quantity": 0,
                    "blocked_quantity": 0,
                    "fifo_price": SECOND_PRICES[OLDER_DATE],
                    "valuation": SECOND_QUANTITY * SECOND_PRICES[RECENT_DATE],
                    "valuation_currency": "EUR",
                    "quote_mid_price": SECOND_PRICES[RECENT_DATE],
                    "quote_currency": "EUR",
                    "quote_timestamp_utc": _event_datetime(RECENT_DATE),
                    "quote_is_outdated": False,
                },
            ],
        },
    },
}

TRANSACTIONS_PAYLOAD = {
    "ok": True,
    "command": "broker.transactions",
    "data": {
        "account_id": ACCOUNT_UID,
        "portfolio_id": PORTFOLIO_ID,
        "resolution": {"account": "selected_context", "portfolio": "selected_context"},
        "result": {
            "account_id": ACCOUNT_UID,
            "portfolio_id": PORTFOLIO_ID,
            "cursor": None,
            "total": 5,
            "count": 5,
            "items": [
                {
                    "id": f"SECURITY_{PORTFOLIO_ID}_BUY",
                    "summary_type": "BrokerSecurityTransactionSummary",
                    "currency": "EUR",
                    # `type` is a coarse category, not the transaction type — real direction is `side`.
                    "type": "SECURITY_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(RECENT_DATE),
                    "description": ETF_NAME,
                    "custodian": "SCALABLE",
                    "documents": [],
                    "unknown_summary_type": False,
                    "isin": ISIN,
                    "security_transaction_type": "SINGLE",
                    "quantity": QUANTITY,
                    "amount": -(QUANTITY * PRICES[RECENT_DATE]),
                    "side": "BUY",
                    "limit_price": None,
                    "stop_price": None,
                },
                {
                    "id": f"CASH_{PORTFOLIO_ID}_DISTRIBUTION",
                    "summary_type": "BrokerCashTransactionSummary",
                    "currency": "EUR",
                    "type": "CASH_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(LATEST_DATE),
                    "description": f"{POSITION_NAME} Dividende",
                    "custodian": "SCALABLE",
                    "documents": [],
                    "unknown_summary_type": False,
                    "related_isin": SECOND_ISIN,
                    "cash_transaction_type": "DISTRIBUTION",
                    "amount": DEFAULT_AMOUNT,
                },
                {
                    "id": f"CASH_{PORTFOLIO_ID}_DEPOSIT",
                    "summary_type": "BrokerCashTransactionSummary",
                    "currency": "EUR",
                    "type": "CASH_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(RECENT_DATE),
                    "description": "Wechselbonus",
                    "custodian": "SCALABLE",
                    "documents": [],
                    "unknown_summary_type": False,
                    "related_isin": None,
                    "cash_transaction_type": "DEPOSIT",
                    "amount": SECOND_AMOUNT,
                },
                {
                    "id": f"CASH_{PORTFOLIO_ID}_TRANSFER",
                    "summary_type": "BrokerCashTransactionSummary",
                    "currency": "EUR",
                    "type": "CASH_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(OLDER_DATE),
                    "description": "Interne Überweisung",
                    "custodian": "SCALABLE",
                    "documents": [],
                    "unknown_summary_type": False,
                    "related_isin": None,
                    "cash_transaction_type": "CASH_TRANSFER_OUT",
                    "amount": -AMOUNT,
                },
                {
                    "id": f"SECURITY_{PORTFOLIO_ID}_NON_TRADE",
                    "summary_type": "BrokerNonTradeSecurityTransactionSummary",
                    "currency": "EUR",
                    "type": "NON_TRADE_SECURITY_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(OLDER_DATE),
                    "description": f"{POSITION_NAME} Depotübertrag",
                    "custodian": "SCALABLE",
                    "documents": [],
                    "unknown_summary_type": False,
                    "isin": SECOND_ISIN,
                    # Quantity is always a positive magnitude; direction comes from this field, not sign.
                    "non_trade_security_transaction_type": "TRANSFER_IN",
                    "quantity": SECOND_QUANTITY,
                    "amount": SECOND_QUANTITY * SECOND_PRICES[OLDER_DATE],
                },
            ],
        },
    },
}

OVERNIGHT_SUMMARY_PAYLOAD = {
    "ok": True,
    "command": "overnight",
    "data": {
        "account": {"display_name": "Tagesgeld", "is_active": True, "owner_kind": "personal"},
        "result": {
            "interest_rate": 2.0,
            "balance": AMOUNT,
            "current_accrued_amount": THIRD_AMOUNT,
            "current_interest_bearing_amount": AMOUNT,
            "deposit_accrued_lifetime_amount": THIRD_AMOUNT,
            "estimated_next_payout_amount": THIRD_AMOUNT,
            "next_payout_date": _event_datetime(LATEST_DATE),
        },
        "savings_account_id": SECOND_ACCOUNT_UID,
        "selection": {"account": "auto_resolve"},
    },
}

OVERNIGHT_TRANSACTIONS_PAYLOAD = {
    "ok": True,
    "command": "overnight.transactions",
    "data": {
        "account": {"display_name": "Tagesgeld", "is_active": True, "owner_kind": "personal"},
        "result": {
            "cursor": None,
            "total": 2,
            "count": 2,
            # Overnight transaction items carry no `summary_type` at all — every item is a cash move.
            "items": [
                {
                    "id": f"CASH_{SECOND_ACCOUNT_UID}_INTEREST",
                    "currency": "EUR",
                    "type": "CASH_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(RECENT_DATE),
                    "description": "Zinsen",
                    "cash_transaction_type": "INTEREST",
                    "amount": THIRD_AMOUNT,
                    "custodian": None,
                    "related_isin": None,
                    "documents": [],
                },
                {
                    "id": f"CASH_{SECOND_ACCOUNT_UID}_TRANSFER",
                    "currency": "EUR",
                    "type": "CASH_TRANSACTION",
                    "status": "SETTLED",
                    "is_cancellation": False,
                    "last_event_datetime": _event_datetime(OLDER_DATE),
                    "description": "Interne Überweisung",
                    "cash_transaction_type": "CASH_TRANSFER_IN",
                    "amount": AMOUNT,
                    "custodian": None,
                    "related_isin": None,
                    "documents": [],
                },
            ],
        },
        "savings_account_id": SECOND_ACCOUNT_UID,
        "selection": {"account": "auto_resolve"},
    },
}

_CHART_POINTS_BY_ISIN = {
    ISIN: [{"mid_price": price, "timestamp_utc": _event_datetime(day)} for day, price in PRICES.items()],
    SECOND_ISIN: [{"mid_price": price, "timestamp_utc": _event_datetime(day)} for day, price in SECOND_PRICES.items()],
}


def _chart_payload(args: tuple[str, ...]) -> dict:
    isin = args[args.index("--isin") + 1]
    points = _CHART_POINTS_BY_ISIN[isin]
    return {
        "ok": True,
        "command": "broker chart",
        "data": {
            "isin": isin,
            "timeframe": "max",
            "currency": "EUR",
            "source": "LSX",
            "closing_reference_point": points[-1],
            "data_points": points,
            "point_count": len(points),
        },
    }


BASE_PAYLOADS = {
    "broker cash-breakdown": [CASH_BREAKDOWN_PAYLOAD],
    "broker holdings": [HOLDINGS_PAYLOAD],
    "overnight": [OVERNIGHT_SUMMARY_PAYLOAD],
}
FULL_PAYLOADS = BASE_PAYLOADS | {
    "broker transactions": [TRANSACTIONS_PAYLOAD],
    "overnight transactions": [OVERNIGHT_TRANSACTIONS_PAYLOAD],
    "broker chart": [_chart_payload],
}


def _command_key(args: tuple[str, ...]) -> str:
    subcommand = []
    for argument in args:
        if argument.startswith("--"):
            break
        subcommand.append(argument)
    return " ".join(subcommand)


def _fake_run_command(
    monkeypatch: pytest.MonkeyPatch, payloads: dict, recorded: list[tuple[str, ...]] | None = None
) -> None:
    queues = {key: list(pages) for key, pages in payloads.items()}

    async def fake(config_dir: Path | None, args: tuple[str, ...]):
        if recorded is not None:
            recorded.append(args)
        key = _command_key(args)
        queue = queues[key]
        payload = queue.pop(0) if len(queue) > 1 else queue[0]
        if callable(payload):
            payload = payload(args)
        if not payload.get("ok"):
            raise RuntimeError(f"fake `sc {key}` returned {payload}")
        data = payload["data"]
        return data["result"] if isinstance(data, dict) and "result" in data else data

    monkeypatch.setattr(target=scalable_capital, name="_run_command", value=fake)


def _session() -> _ScalableCapitalSession:
    return _ScalableCapitalSession(config_dir=None)


def _fetched_session(monkeypatch: pytest.MonkeyPatch, payloads: dict | None = None) -> _ScalableCapitalSession:
    _fake_run_command(monkeypatch=monkeypatch, payloads=payloads or FULL_PAYLOADS)
    session = _session()
    session.get_accounts()
    return session


def test_information_for_user_exposes_no_required_fields():
    assert BANKS_BY_NAME["scalable_capital"].information_for_user["required_fields"] == []


def _handler() -> ScalableCapitalHandler:
    return ScalableCapitalHandler(bank_info=BANKS_BY_NAME["scalable_capital"], credentials={})


def test_begin_two_factor_challenge_delegates_to_login_module(monkeypatch: pytest.MonkeyPatch):
    expires_at = datetime.now() + timedelta(minutes=15)
    calls: list[int] = []

    def fake_start(credential_id: int):
        calls.append(credential_id)
        return CHALLENGE_TOKEN, SCALABLE_AUTHORIZATION_URL, TWO_FACTOR_CODE, expires_at

    monkeypatch.setattr(target=scalable_capital, name="ensure_cli_binary_available", value=lambda: None)
    monkeypatch.setattr(target=scalable_capital_login, name="start", value=fake_start)

    challenge = _handler().begin_two_factor_challenge(credential_id=7)

    assert challenge == TwoFactorChallenge(
        challenge_token=CHALLENGE_TOKEN,
        expires_at=expires_at,
        authorization_url=SCALABLE_AUTHORIZATION_URL,
        device_code=TWO_FACTOR_CODE,
    )
    assert calls == [7]


def test_complete_two_factor_challenge_returns_session_state(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict] = []

    def fake_complete(challenge_token: str, credential_id: int):
        calls.append({"challenge_token": challenge_token, "credential_id": credential_id})
        return {"archive": SESSION_ARCHIVE}

    monkeypatch.setattr(target=scalable_capital_login, name="complete", value=fake_complete)

    session_state = _handler().complete_two_factor_challenge(
        challenge_token=CHALLENGE_TOKEN, credential_id=7, code="unused"
    )

    assert session_state == {"archive": SESSION_ARCHIVE}
    assert calls == [{"challenge_token": CHALLENGE_TOKEN, "credential_id": 7}]


def test_session_without_session_state_requires_reauthentication():
    handler = _handler()
    handler.session_state = None

    with pytest.raises(ReauthenticationRequiredError):
        with handler.session():
            pass


def test_get_accounts_lists_cash_positions_and_overnight(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    with caplog.at_level(logging.DEBUG):
        session = _fetched_session(monkeypatch)

    accounts = {account.name: account.external_id for account in session.get_accounts()}

    assert_log_contains(caplog, message="Fetched 4 account(s)")

    assert accounts == {
        "Scalable Capital Verrechnungskonto": f"scalable-cash-{ACCOUNT_UID}",
        ETF_NAME: ISIN,
        POSITION_NAME: SECOND_ISIN,
        "Scalable Capital Tagesgeld": "scalable-overnight",
    }


def test_cash_balance_comes_from_the_cash_breakdown_command(monkeypatch: pytest.MonkeyPatch):
    session = _fetched_session(monkeypatch)

    assert session.get_balance(CASH_ACCOUNT) == pytest.approx(DEFAULT_BALANCE)


def test_overnight_balance_comes_from_the_overnight_summary(monkeypatch: pytest.MonkeyPatch):
    session = _fetched_session(monkeypatch)

    assert session.get_balance(OVERNIGHT_ACCOUNT) == pytest.approx(AMOUNT)


def test_missing_overnight_account_is_not_fatal(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.DEBUG):
        session = _fetched_session(monkeypatch, payloads=FULL_PAYLOADS | {"overnight": [{"ok": False}]})

    names = {account.name for account in session.get_accounts()}

    assert names == {"Scalable Capital Verrechnungskonto", ETF_NAME, POSITION_NAME}
    assert_log_contains(caplog, message="No overnight/Tagesgeld account available, skipping")


def test_transactions_are_routed_to_the_cash_and_position_accounts(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    session = _fetched_session(monkeypatch)
    start_date = OLDER_DATE

    with caplog.at_level(logging.DEBUG):
        cash = session.get_transactions(CASH_ACCOUNT, start_date=start_date)
    assert_log_contains(caplog, message=f"Fetched 5 transaction(s) for {CASH_ACCOUNT.name}")
    position = session.get_transactions(FetchedAccount(name=POSITION_NAME), start_date=start_date)
    tagesgeld = session.get_transactions(OVERNIGHT_ACCOUNT, start_date=start_date)

    assert {(t.amount, t.transaction_type) for t in cash} == {
        (-(QUANTITY * PRICES[RECENT_DATE]), TransactionType.BUY),
        (DEFAULT_AMOUNT, TransactionType.DIVIDEND),
        (SECOND_AMOUNT, TransactionType.DEPOSIT),
        (-AMOUNT, TransactionType.TRANSFER_OUT),
        (SECOND_QUANTITY * SECOND_PRICES[OLDER_DATE], TransactionType.TRANSFER_IN),
    }
    # The dividend references the second position via `related_isin`, the depot transfer via `isin`.
    assert {(t.amount, t.transaction_type) for t in position} == {
        (DEFAULT_AMOUNT, TransactionType.DIVIDEND),
        (SECOND_QUANTITY * SECOND_PRICES[OLDER_DATE], TransactionType.TRANSFER_IN),
    }
    assert {(t.amount, t.transaction_type) for t in tagesgeld} == {
        (THIRD_AMOUNT, TransactionType.INTEREST),
        (AMOUNT, TransactionType.TRANSFER_IN),
    }


def test_broker_transactions_are_fetched_once_for_the_full_history(monkeypatch: pytest.MonkeyPatch):
    recorded: list[tuple[str, ...]] = []
    _fake_run_command(monkeypatch=monkeypatch, payloads=FULL_PAYLOADS, recorded=recorded)
    session = _session()
    session.get_accounts()

    session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)
    session.get_market_value_history(FetchedAccount(name=ETF_NAME))

    broker_calls = [args for args in recorded if args[:2] == ("broker", "transactions")]
    # Both callers share one cached fetch, and it covers the whole history: no --from-time window.
    assert len(broker_calls) == 1
    assert broker_calls[0][broker_calls[0].index("--status") + 1] == "SETTLED"
    assert broker_calls[0][broker_calls[0].index("--page-size") + 1] == "100"
    assert "--from-time" not in broker_calls[0]

    # The overnight history has only one consumer, so it stays filtered by the CLI.
    overnight_call = next(args for args in recorded if args[:2] == ("overnight", "transactions"))
    assert overnight_call[overnight_call.index("--from-time") + 1] == f"{OLDER_DATE.isoformat()}T00:00:00Z"
    assert overnight_call[overnight_call.index("--page-size") + 1] == "100"


def test_broker_transactions_before_the_start_date_are_dropped(monkeypatch: pytest.MonkeyPatch):
    session = _fetched_session(monkeypatch)

    cash = session.get_transactions(CASH_ACCOUNT, start_date=LATEST_DATE)

    # Only the dividend is inside the window; everything older is sliced off locally.
    assert {(t.amount, t.transaction_type) for t in cash} == {(DEFAULT_AMOUNT, TransactionType.DIVIDEND)}


def test_get_balance_observations_returns_a_single_point_for_today(monkeypatch: pytest.MonkeyPatch):
    session = _fetched_session(monkeypatch)

    observations = session.get_balance_observations(FetchedAccount(name=ETF_NAME))

    assert len(observations) == 1
    assert observations[0].date == date.today()
    assert observations[0].amount == pytest.approx(QUANTITY * PRICES[LATEST_DATE])


def test_market_value_history_is_built_from_chart_prices_and_share_moves(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    session = _fetched_session(monkeypatch)

    with caplog.at_level(logging.DEBUG):
        history = session.get_market_value_history(FetchedAccount(name=ETF_NAME))

    assert_log_contains(caplog, message=f"Valued {ETF_NAME} ({ISIN}): 2 daily snapshot(s)")

    # The oldest price point predates the only buy, so it carries no position yet.
    assert [(observation.date, observation.amount) for observation in history] == [
        (RECENT_DATE, pytest.approx(QUANTITY * PRICES[RECENT_DATE])),
        (LATEST_DATE, pytest.approx(QUANTITY * PRICES[LATEST_DATE])),
    ]


def test_market_value_history_counts_non_trade_transfers_as_share_moves(monkeypatch: pytest.MonkeyPatch):
    session = _fetched_session(monkeypatch)

    history = session.get_market_value_history(FetchedAccount(name=POSITION_NAME))

    assert [(observation.date, observation.amount) for observation in history] == [
        (OLDER_DATE, pytest.approx(SECOND_QUANTITY * SECOND_PRICES[OLDER_DATE])),
        (RECENT_DATE, pytest.approx(SECOND_QUANTITY * SECOND_PRICES[RECENT_DATE])),
    ]


def test_market_value_history_is_empty_without_chart_data(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    session = _fetched_session(monkeypatch, payloads=FULL_PAYLOADS | {"broker chart": [{"ok": False}]})

    with caplog.at_level(logging.DEBUG):
        # A one-point fallback would be truthy and make the sync replace the stored chart with it.
        assert session.get_market_value_history(FetchedAccount(name=ETF_NAME)) == []

    assert_log_contains(caplog, message=f"No chart data for {ISIN}; skipping its value history")


def test_market_value_history_is_empty_for_cash_accounts(monkeypatch: pytest.MonkeyPatch):
    session = _fetched_session(monkeypatch)

    assert session.get_market_value_history(CASH_ACCOUNT) == []
    assert session.get_market_value_history(OVERNIGHT_ACCOUNT) == []


def test_missing_overnight_account_skips_overnight_transactions_fetch(monkeypatch: pytest.MonkeyPatch):
    # No "overnight transactions" queue entry: a fetch would raise KeyError, proving it is skipped
    # once _fetch() found no overnight/Tagesgeld product.
    payloads = {key: value for key, value in FULL_PAYLOADS.items() if key != "overnight transactions"}
    session = _fetched_session(monkeypatch, payloads=payloads | {"overnight": [{"ok": False}]})

    cash = session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    assert cash


def _patch_cli_output(
    monkeypatch: pytest.MonkeyPatch, payloads: list[dict | str], returncode: int = 0, stderr: bytes = b""
) -> None:
    class _FakeProcess:
        def __init__(self, payload: dict | str):
            self._payload = payload
            self.returncode = returncode

        async def communicate(self):
            # A plain string stands for output that is not the expected `{"ok": ...}` JSON envelope.
            stdout = json.dumps(self._payload) if isinstance(self._payload, dict) else self._payload
            return stdout.encode(), stderr

    async def fake_create_subprocess_exec(*args: object, **kwargs: object):
        return _FakeProcess(payloads.pop(0) if len(payloads) > 1 else payloads[0])

    monkeypatch.setattr(target=asyncio, name="create_subprocess_exec", value=fake_create_subprocess_exec)


@pytest.mark.parametrize(
    argnames="error_code", argvalues=["no_session", "refresh_relogin_required", "auth_grant_not_enabled"]
)
def test_run_command_maps_auth_error_codes_to_reauthentication_required(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, error_code: str
):
    _patch_cli_output(
        monkeypatch=monkeypatch,
        payloads=[{"ok": False, "error": {"code": error_code, "message": "no active session"}}],
        returncode=20,
    )

    with pytest.raises(ReauthenticationRequiredError) as error:
        asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))

    assert f"`{HOLDINGS_COMMAND}` was rejected ({error_code})" in str(error.value)


def test_run_command_does_not_ask_for_a_relogin_on_a_config_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    _patch_cli_output(
        monkeypatch=monkeypatch,
        payloads=[{"ok": False, "error": {"code": "secret_storage_unavailable", "message": "keyring missing"}}],
        returncode=20,
    )

    with pytest.raises(RuntimeError, match="secret_storage_unavailable"):
        asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))


def test_run_command_unwraps_the_result_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    _patch_cli_output(monkeypatch=monkeypatch, payloads=[HOLDINGS_PAYLOAD])

    assert (
        asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))
        == HOLDINGS_PAYLOAD["data"]["result"]
    )


def test_run_command_passes_through_data_without_a_result_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    # `broker chart` is the one command whose `data` is the projection directly, with no `result` key.
    chart_payload = _chart_payload(("broker", "chart", "--isin", ISIN))
    _patch_cli_output(monkeypatch=monkeypatch, payloads=[chart_payload])

    result = asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "chart", "--isin", ISIN)))

    assert result == chart_payload["data"]


def test_run_command_retries_after_a_rate_limited_response(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    rate_limited = {"ok": False, "error": {"code": "rate_limited", "message": "backend rate limit exceeded"}}
    responses = [rate_limited, rate_limited, HOLDINGS_PAYLOAD]
    _patch_cli_output(monkeypatch=monkeypatch, payloads=responses)
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(target=asyncio, name="sleep", value=fake_sleep)

    result = asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))

    assert result == HOLDINGS_PAYLOAD["data"]["result"]
    assert responses == [HOLDINGS_PAYLOAD]
    assert sleeps == [2, 4]
    assert_log_contains(
        caplog,
        messages=[
            f"Rate-limited `{HOLDINGS_COMMAND}`; retrying in 2s",
            f"Rate-limited `{HOLDINGS_COMMAND}`; retrying in 4s",
        ],
    )


def test_run_command_gives_up_after_exhausting_rate_limit_retries(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    _patch_cli_output(
        monkeypatch=monkeypatch,
        payloads=[{"ok": False, "error": {"code": "rate_limited", "message": "backend rate limit exceeded"}}],
    )

    async def fake_sleep(delay: float) -> None:
        pass

    monkeypatch.setattr(target=asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(RuntimeError, match="rate_limited"):
        asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))


def _paged_payload(items: list[dict], cursor: str | None, command: str = "broker.transactions") -> dict:
    return {"ok": True, "command": command, "data": {"result": {"cursor": cursor, "items": items}}}


BROKER_ITEMS = TRANSACTIONS_PAYLOAD["data"]["result"]["items"]
OVERNIGHT_ITEMS = OVERNIGHT_TRANSACTIONS_PAYLOAD["data"]["result"]["items"]

# One position bought as an ELTIF (priced by `eltif_quantity`), partly sold, then transferred out
SHARE_MOVE_PAYLOAD = _paged_payload(
    items=[
        {
            "id": "eltif-buy",
            "summary_type": "BrokerEltifTransactionSummary",
            "status": "SETTLED",
            "last_event_datetime": _event_datetime(OLDER_DATE),
            "description": ETF_NAME,
            "isin": ISIN,
            # ELTIF summaries carry `eltif_quantity` where every other summary carries `quantity`
            "eltif_quantity": QUANTITY,
            "amount": -(QUANTITY * PRICES[OLDER_DATE]),
            "side": "BUY",
        },
        {
            "id": "sell",
            "summary_type": "BrokerSecurityTransactionSummary",
            "status": "SETTLED",
            "last_event_datetime": _event_datetime(RECENT_DATE),
            "description": ETF_NAME,
            "isin": ISIN,
            "quantity": SOLD_QUANTITY,
            "amount": SOLD_QUANTITY * PRICES[RECENT_DATE],
            "side": "SELL",
        },
        {
            "id": "transfer-out",
            "summary_type": "BrokerNonTradeSecurityTransactionSummary",
            "status": "SETTLED",
            "last_event_datetime": _event_datetime(LATEST_DATE),
            "description": ETF_NAME,
            "isin": ISIN,
            "non_trade_security_transaction_type": "TRANSFER_OUT",
            "quantity": QUANTITY - SOLD_QUANTITY,
            "amount": -((QUANTITY - SOLD_QUANTITY) * PRICES[LATEST_DATE]),
        },
    ],
    cursor=None,
)


def test_ensure_cli_binary_available_names_the_missing_binary_and_the_docs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    missing_binary = tmp_path / "sc"
    monkeypatch.setattr(target=scalable_capital, name="SCALABLE_CLI_BIN", value=missing_binary)

    with pytest.raises(RuntimeError) as error:
        scalable_capital.ensure_cli_binary_available()

    assert str(missing_binary) in str(error.value)
    assert "docs/bank_handlers/scalable_capital.md" in str(error.value)


def test_session_requires_the_cli_binary(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(target=scalable_capital, name="SCALABLE_CLI_BIN", value=tmp_path / "sc")
    handler = _handler()
    handler.session_state = {"archive": SESSION_ARCHIVE}

    with pytest.raises(RuntimeError, match="CLI binary is missing"):
        with handler.session():
            pass


def test_session_restores_the_config_dir_and_stores_the_refreshed_state(monkeypatch: pytest.MonkeyPatch):
    written: list[dict] = []
    monkeypatch.setattr(target=scalable_capital, name="ensure_cli_binary_available", value=lambda: None)
    monkeypatch.setattr(
        target=scalable_capital_login,
        name="write_session_state",
        value=lambda config_dir, session_state: written.append({"dir": config_dir, "state": session_state}),
    )
    monkeypatch.setattr(
        target=scalable_capital_login,
        name="read_session_state",
        value=lambda config_dir: {"archive": SECOND_SESSION_ARCHIVE},
    )
    handler = _handler()
    handler.session_state = {"archive": SESSION_ARCHIVE}

    with handler.session() as session:
        config_dir = session._config_dir
        assert config_dir.exists()

    assert written == [{"dir": config_dir, "state": {"archive": SESSION_ARCHIVE}}]
    # The refreshed CLI state is read back so a rotated refresh token survives the sync.
    assert handler.session_state == {"archive": SECOND_SESSION_ARCHIVE}
    assert not config_dir.exists()


def test_session_with_an_unusable_session_state_requires_reauthentication(monkeypatch: pytest.MonkeyPatch):
    def fake_write(config_dir: Path, session_state: dict):
        raise ValueError("does not contain a CLI config archive")

    monkeypatch.setattr(target=scalable_capital, name="ensure_cli_binary_available", value=lambda: None)
    monkeypatch.setattr(target=scalable_capital_login, name="write_session_state", value=fake_write)
    handler = _handler()
    handler.session_state = {"legacy": SESSION_ARCHIVE}

    with pytest.raises(ReauthenticationRequiredError, match="does not contain a CLI config archive"):
        with handler.session():
            pass


def test_run_command_reports_the_full_command_and_stderr_when_the_cli_prints_no_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    _patch_cli_output(monkeypatch=monkeypatch, payloads=["not json"], returncode=101, stderr=b"sc: segfault")

    with pytest.raises(RuntimeError) as error:
        asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))

    assert f"`{HOLDINGS_COMMAND}` failed (exit code 101)" in str(error.value)
    assert "not json" in str(error.value)  # stdout wins; stderr is only the fallback


def test_run_command_falls_back_to_stderr_when_stdout_is_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    _patch_cli_output(monkeypatch=monkeypatch, payloads=[""], returncode=101, stderr=b"sc: segfault")

    with pytest.raises(RuntimeError, match="sc: segfault"):
        asyncio.run(scalable_capital._run_command(config_dir=tmp_path, args=("broker", "holdings")))


def test_broker_transactions_follow_the_cursor_across_pages(monkeypatch: pytest.MonkeyPatch):
    payloads = FULL_PAYLOADS | {
        "broker transactions": [
            _paged_payload(items=BROKER_ITEMS[:2], cursor="page-2"),
            _paged_payload(items=BROKER_ITEMS[2:], cursor=None),
        ]
    }
    recorded: list[tuple[str, ...]] = []
    _fake_run_command(monkeypatch=monkeypatch, payloads=payloads, recorded=recorded)
    session = _session()
    session.get_accounts()

    cash = session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    assert len(cash) == len(BROKER_ITEMS)
    broker_calls = [args for args in recorded if args[:2] == ("broker", "transactions")]
    assert len(broker_calls) == 2
    assert "--cursor" not in broker_calls[0]
    assert broker_calls[1][broker_calls[1].index("--cursor") + 1] == "page-2"


def test_pagination_stops_when_the_cli_keeps_returning_the_same_cursor(monkeypatch: pytest.MonkeyPatch):
    payloads = FULL_PAYLOADS | {"broker transactions": [_paged_payload(items=BROKER_ITEMS[:1], cursor="stuck")]}
    recorded: list[tuple[str, ...]] = []
    _fake_run_command(monkeypatch=monkeypatch, payloads=payloads, recorded=recorded)
    session = _session()
    session.get_accounts()

    session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    # Second page repeats the cursor of the first one, so paging stops instead of looping forever.
    assert len([args for args in recorded if args[:2] == ("broker", "transactions")]) == 2


def test_pagination_gives_up_after_the_page_cap(monkeypatch: pytest.MonkeyPatch):
    pages = itertools.count()
    payloads = FULL_PAYLOADS | {
        "broker transactions": [lambda args: _paged_payload(items=BROKER_ITEMS[:1], cursor=f"page-{next(pages)}")]
    }
    recorded: list[tuple[str, ...]] = []
    _fake_run_command(monkeypatch=monkeypatch, payloads=payloads, recorded=recorded)
    monkeypatch.setattr(target=scalable_capital, name="_MAX_TRANSACTION_PAGES", value=3)
    session = _session()
    session.get_accounts()

    session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    # A CLI handing back a fresh cursor forever must not keep the sync running indefinitely.
    assert len([args for args in recorded if args[:2] == ("broker", "transactions")]) == 3


def test_overnight_transactions_that_are_not_settled_are_ignored(monkeypatch: pytest.MonkeyPatch):
    pending = OVERNIGHT_ITEMS[0] | {"id": "pending-interest", "status": "PENDING"}
    payloads = FULL_PAYLOADS | {
        "overnight transactions": [
            _paged_payload(items=[pending, OVERNIGHT_ITEMS[1]], cursor=None, command="overnight.transactions")
        ]
    }
    session = _fetched_session(monkeypatch, payloads=payloads)

    transactions = session.get_transactions(OVERNIGHT_ACCOUNT, start_date=OLDER_DATE)

    assert [transaction.bank_reference for transaction in transactions] == [OVERNIGHT_ITEMS[1]["id"]]


def test_an_unknown_cash_transaction_type_falls_back_to_the_amount_sign(monkeypatch: pytest.MonkeyPatch):
    unknown = {
        "id": "unknown",
        "summary_type": "BrokerCashTransactionSummary",
        "status": "SETTLED",
        "last_event_datetime": _event_datetime(RECENT_DATE),
        "description": "Neue Buchungsart",
        "cash_transaction_type": "SOMETHING_SCALABLE_ADDED_LATER",
        "amount": -DEFAULT_AMOUNT,
    }
    payloads = FULL_PAYLOADS | {"broker transactions": [_paged_payload(items=[unknown], cursor=None)]}
    session = _fetched_session(monkeypatch, payloads=payloads)

    cash = session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    assert [transaction.transaction_type for transaction in cash] == [TransactionType.OUTGOING]


def test_sales_and_non_trade_transfers_out_keep_their_transaction_type(monkeypatch: pytest.MonkeyPatch):
    payloads = FULL_PAYLOADS | {"broker transactions": [SHARE_MOVE_PAYLOAD]}
    session = _fetched_session(monkeypatch, payloads=payloads)

    cash = session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    assert [transaction.transaction_type for transaction in cash] == [
        TransactionType.BUY,
        TransactionType.SELL,
        TransactionType.TRANSFER_OUT,
    ]


def test_share_moves_cover_eltif_quantities_sales_and_transfers_out(monkeypatch: pytest.MonkeyPatch):
    payloads = FULL_PAYLOADS | {"broker transactions": [SHARE_MOVE_PAYLOAD]}
    session = _fetched_session(monkeypatch, payloads=payloads)

    history = session.get_market_value_history(FetchedAccount(name=ETF_NAME))

    # All ELTIF units first, then the sold ones gone, then the rest transferred out.
    assert [(observation.date, observation.amount) for observation in history] == [
        (OLDER_DATE, pytest.approx(QUANTITY * PRICES[OLDER_DATE])),
        (RECENT_DATE, pytest.approx((QUANTITY - SOLD_QUANTITY) * PRICES[RECENT_DATE])),
        (LATEST_DATE, pytest.approx(0.0)),
    ]


def test_cash_external_id_falls_back_when_the_cli_reports_no_account_id(monkeypatch: pytest.MonkeyPatch):
    cash_breakdown = {
        "ok": True,
        "command": "broker.cash-breakdown",
        "data": {"result": {"cash_balance": DEFAULT_BALANCE}},
    }
    session = _fetched_session(monkeypatch, payloads=FULL_PAYLOADS | {"broker cash-breakdown": [cash_breakdown]})

    cash = next(account for account in session.get_accounts() if account.name == CASH_ACCOUNT.name)

    assert cash.external_id == "scalable-cash-scalable_capital"


def test_unavailable_overnight_transactions_are_skipped(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    payloads = FULL_PAYLOADS | {"overnight transactions": [{"ok": False}]}
    session = _fetched_session(monkeypatch, payloads=payloads)

    with caplog.at_level(logging.DEBUG):
        cash = session.get_transactions(CASH_ACCOUNT, start_date=OLDER_DATE)

    assert cash  # the broker side of the sync still went through
    assert session.get_transactions(OVERNIGHT_ACCOUNT, start_date=OLDER_DATE) == []
    assert_log_contains(caplog, message="Overnight/Tagesgeld transactions unavailable, skipping")
