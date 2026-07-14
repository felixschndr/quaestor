import asyncio
import logging
from datetime import date, datetime, timedelta

import pytest

from source.backend.bank_handlers import BANKS_BY_NAME, trade_republic
from source.backend.bank_handlers.base import (
    BalanceObservation,
    FetchedAccount,
    TwoFactorChallenge,
)
from source.backend.bank_handlers.trade_republic import (
    TradeRepublicHandler,
    _TradeRepublicSession,
)
from source.backend.models.transaction_type import TransactionType
from source.backend.services import trade_republic_login
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    CHALLENGE_TOKEN,
    ETF_NAME,
    ISIN,
    PHONE_NUMBER,
    PIN,
    SECOND_ISIN,
    assert_log_contains,
)


def test_information_for_user_exposes_phone_and_pin_field_rules():
    rules = BANKS_BY_NAME["trade_republic"].information_for_user["field_rules"]

    assert rules["phone"]["strip_whitespace"] is True
    assert rules["pin"]["strip_whitespace"] is False
    assert any(rule["regex"] == r"^\+" for rule in rules["phone"]["rules"])
    assert any(rule["regex"] == r"^\d{4}$" for rule in rules["pin"]["rules"])
    for field_rules in rules.values():
        for rule in field_rules["rules"]:
            assert rule["name"] and rule["description"]


class _FakeExporter:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def fields(self) -> list[str]:
        return ["date", "type", "value", "note", "isin", "shares", "fees", "taxes", "isin2", "shares2"]

    def from_event(self, event: dict):
        # The patched Event.from_dict is the identity, so an event already is a row dict.
        yield event


def _patch_pytr(monkeypatch: pytest.MonkeyPatch, rows: list[dict], captured: dict) -> None:
    class _FakeTimeline:
        def __init__(self, tr: object, output_path: object, not_before: float, **kwargs: object) -> None:
            captured["not_before"] = not_before
            self.events: list[dict] = []

        async def tl_loop(self) -> None:
            self.events = rows

    monkeypatch.setattr(target=trade_republic, name="Timeline", value=_FakeTimeline)
    monkeypatch.setattr(target=trade_republic.Event, name="from_dict", value=staticmethod(lambda raw: raw))
    monkeypatch.setattr(target=trade_republic, name="TransactionExporter", value=_FakeExporter)


def _session() -> _TradeRepublicSession:
    session = _TradeRepublicSession(trade_republic_client=object())
    session._cash_account_name = ACCOUNT_IBAN
    session._account(ACCOUNT_IBAN)
    session._account(ETF_NAME)["isin"] = ISIN
    return session


def test_cash_and_position_transactions_are_routed_to_the_right_account(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {"date": "2026-05-13", "type": "Removal", "value": -500.0, "note": "Alice Parker", "isin": None},
        {
            "date": "2025-03-24",
            "type": "Buy",
            "value": -54801.0,
            "note": ETF_NAME,
            "isin": ISIN,
        },
        {"date": "2025-01-01", "type": "Tax Refund", "value": None, "note": "skip me", "isin": None},
    ]
    _patch_pytr(monkeypatch=monkeypatch, rows=rows, captured={})
    session = _session()

    cash = session.get_transactions(FetchedAccount(name=ACCOUNT_IBAN), start_date=date(year=2025, month=1, day=1))
    position = session.get_transactions(FetchedAccount(name=ETF_NAME), start_date=date(year=2025, month=1, day=1))

    assert [(t.amount, t.transaction_type, t.date) for t in cash] == [
        (-500.0, TransactionType.REMOVAL, date(year=2026, month=5, day=13)),
        (-54801.0, TransactionType.BUY, date(year=2025, month=3, day=24)),
    ]
    assert [(t.amount, t.transaction_type, t.date) for t in position] == [
        (-54801.0, TransactionType.BUY, date(year=2025, month=3, day=24))
    ]


def test_position_trades_also_appear_in_the_cash_account(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {"date": "2026-05-13", "type": "Deposit", "value": 1000.0, "note": "Alice Parker", "isin": None},
        {
            "date": "2026-05-14",
            "type": "Buy",
            "value": -600.0,
            "note": ETF_NAME,
            "isin": ISIN,
        },
    ]
    _patch_pytr(monkeypatch=monkeypatch, rows=rows, captured={})
    session = _session()

    cash = session.get_transactions(FetchedAccount(name=ACCOUNT_IBAN), start_date=date(year=2026, month=1, day=1))
    position = session.get_transactions(FetchedAccount(name=ETF_NAME), start_date=date(year=2026, month=1, day=1))

    assert [(t.amount, t.transaction_type, t.date) for t in cash] == [
        (1000.0, TransactionType.DEPOSIT, date(year=2026, month=5, day=13)),
        (-600.0, TransactionType.BUY, date(year=2026, month=5, day=14)),
    ]
    assert [(t.amount, t.transaction_type, t.date) for t in position] == [
        (-600.0, TransactionType.BUY, date(year=2026, month=5, day=14))
    ]


def test_get_accounts_lists_cash_and_positions(monkeypatch: pytest.MonkeyPatch):
    session = _session()

    async def _noop() -> None:
        pass

    monkeypatch.setattr(target=session, name="_fetch", value=_noop)

    assert {account.name for account in session.get_accounts()} == {ACCOUNT_IBAN, ETF_NAME}


def test_share_moves_only_count_buys_and_sells(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {"date": "2025-03-24", "type": "Buy", "isin": ISIN, "shares": "10"},
        {"date": "2025-04-01", "type": "Buy", "isin": ISIN, "shares": "5"},
        {"date": "2025-05-01", "type": "Sell", "isin": ISIN, "shares": "3"},
        {"date": "2025-06-27", "type": "Dividend", "isin": ISIN, "shares": "12"},  # holding, not a move
        {"date": "2025-03-24", "type": "Deposit", "isin": None, "shares": None},  # cash, ignored
    ]
    _patch_pytr(monkeypatch=monkeypatch, rows=[], captured={})

    moves = _TradeRepublicSession._share_moves_by_isin(rows)

    assert moves[ISIN] == [
        (date(year=2025, month=3, day=24), 10.0),
        (date(year=2025, month=4, day=1), 5.0),
        (date(year=2025, month=5, day=1), -3.0),
    ]


def test_value_series_multiplies_holding_by_daily_close():
    moves = [(date(year=2025, month=3, day=24), 10.0), (date(year=2025, month=4, day=1), 5.0)]
    prices = {
        date(year=2025, month=3, day=23): 90.0,  # before the first trade -> skipped
        date(year=2025, month=3, day=24): 100.0,
        date(year=2025, month=3, day=25): 110.0,
        date(year=2025, month=4, day=1): 120.0,
    }

    series = _TradeRepublicSession._market_value_series(name="World", isin=ISIN, moves=moves, prices=prices)

    assert [(observation.date, observation.amount) for observation in series] == [
        (date(year=2025, month=3, day=24), 1000.0),
        (date(year=2025, month=3, day=25), 1100.0),
        (date(year=2025, month=4, day=1), 1800.0),
    ]


def test_value_series_logs_debug_summary(caplog: pytest.LogCaptureFixture):
    moves = [(date(year=2025, month=3, day=24), 10.0)]
    prices = {date(year=2025, month=3, day=24): 100.0}

    with caplog.at_level(logging.DEBUG):
        _TradeRepublicSession._market_value_series(name="World", isin=ISIN, moves=moves, prices=prices)

    assert_log_contains(caplog, message="valued World")


def test_value_series_without_prices_is_empty():
    moves = [(date(year=2025, month=3, day=24), 10.0)]

    assert _TradeRepublicSession._market_value_series(name="World", isin=ISIN, moves=moves, prices={}) == []


def test_market_value_history_is_empty_for_cash_account():
    session = _session()

    assert session.get_market_value_history(FetchedAccount(name=ACCOUNT_IBAN)) == []


def test_market_value_history_is_fetched_once_and_cached(monkeypatch: pytest.MonkeyPatch):
    session = _session()
    calls = {"count": 0}
    expected = [BalanceObservation(date=date(year=2025, month=3, day=24), amount=1000.0)]

    async def fake_fetch_value_history() -> dict:  # noqa: ASYNC124 — must be awaitable for asyncio.run
        calls["count"] += 1
        return {ETF_NAME: expected}

    monkeypatch.setattr(target=session, name="_fetch_value_history", value=fake_fetch_value_history)

    first = session.get_market_value_history(FetchedAccount(name=ETF_NAME))
    second = session.get_market_value_history(FetchedAccount(name=ETF_NAME))

    assert first == second == expected
    assert calls["count"] == 1


def test_start_date_is_passed_to_the_timeline_as_not_before(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}
    _patch_pytr(monkeypatch=monkeypatch, rows=[], captured=captured)
    session = _session()

    start_date = date(year=2025, month=3, day=4)
    session.get_transactions(FetchedAccount(name=ACCOUNT_IBAN), start_date=start_date)

    expected = datetime.combine(date=start_date, time=datetime.min.time()).astimezone().timestamp()
    assert captured["not_before"] == expected


def test_timeline_is_only_fetched_once_per_session(monkeypatch: pytest.MonkeyPatch):
    calls = {"count": 0}

    class _CountingTimeline:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.events: list[dict] = []

        async def tl_loop(self) -> None:
            calls["count"] += 1

    monkeypatch.setattr(target=trade_republic, name="Timeline", value=_CountingTimeline)
    monkeypatch.setattr(target=trade_republic.Event, name="from_dict", value=staticmethod(lambda raw: raw))
    monkeypatch.setattr(target=trade_republic, name="TransactionExporter", value=_FakeExporter)
    session = _session()

    session.get_transactions(FetchedAccount(name=ACCOUNT_IBAN), start_date=date(year=2025, month=1, day=1))
    session.get_transactions(FetchedAccount(name=ETF_NAME), start_date=date(year=2025, month=1, day=1))

    assert calls["count"] == 1


def _handler() -> TradeRepublicHandler:
    return TradeRepublicHandler(
        bank_info=(BANKS_BY_NAME["trade_republic"]), credentials={"phone": PHONE_NUMBER, "pin": PIN}
    )


def test_begin_two_factor_challenge_starts_login_with_credentials(monkeypatch: pytest.MonkeyPatch):
    expires_at = datetime.now() + timedelta(minutes=5)
    calls: list[dict] = []

    def fake_start(credential_id: int, phone_no: str, pin: str) -> tuple[str, datetime]:
        calls.append({"credential_id": credential_id, "phone_no": phone_no, "pin": pin})
        return CHALLENGE_TOKEN, expires_at

    monkeypatch.setattr(target=trade_republic_login, name="start", value=fake_start)

    challenge = _handler().begin_two_factor_challenge(credential_id=7)

    assert challenge == TwoFactorChallenge(challenge_token=CHALLENGE_TOKEN, expires_at=expires_at)
    assert calls == [{"credential_id": 7, "phone_no": PHONE_NUMBER, "pin": PIN}]


def test_complete_two_factor_challenge_returns_session_state(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict] = []

    def fake_complete(challenge_token: str, credential_id: int, code: str) -> str:
        calls.append({"challenge_token": challenge_token, "credential_id": credential_id, "code": code})
        return "fresh-cookie"

    monkeypatch.setattr(target=trade_republic_login, name="complete", value=fake_complete)

    session_state = _handler().complete_two_factor_challenge(
        challenge_token=CHALLENGE_TOKEN, credential_id=7, code="0000"
    )

    assert session_state == {"cookies": "fresh-cookie"}
    assert calls == [{"challenge_token": CHALLENGE_TOKEN, "credential_id": 7, "code": "0000"}]


def test_fetch_values_positions_via_ticker_and_routes_cash(monkeypatch: pytest.MonkeyPatch):
    class _FakeClient:
        async def close(self):  # noqa: ASYNC124
            pass

    session = _TradeRepublicSession(trade_republic_client=_FakeClient())

    async def fake_subscribe_once(payload: dict, expected_type: str):  # noqa: ASYNC124
        if expected_type == "cash":
            return [{"accountNumber": ACCOUNT_IBAN, "currencyId": "EUR", "amount": 100.5}]
        if expected_type == "compactPortfolioByType":
            return {
                "categories": [
                    {
                        "categoryType": "stocksAndETFs",
                        "positions": [
                            {"isin": ISIN, "name": ETF_NAME, "netSize": "10", "bondInfo": None},
                        ],
                    },
                    {
                        "categoryType": "bonds",
                        "positions": [
                            {"isin": SECOND_ISIN, "name": "Some Bond 2030", "netSize": "1000", "bondInfo": {"x": 1}},
                        ],
                    },
                ]
            }
        if expected_type == "ticker":
            price = {f"{ISIN}.LSX": "120.0", f"{SECOND_ISIN}.LSX": "98.5"}[payload["id"]]
            return {"last": {"price": price}}
        raise AssertionError(f"unexpected topic {expected_type}")

    async def fake_instrument_exchange(isin: str) -> str:  # noqa: ASYNC124
        return "LSX"

    monkeypatch.setattr(target=session, name="_subscribe_once", value=fake_subscribe_once)
    monkeypatch.setattr(target=session, name="_instrument_exchange", value=fake_instrument_exchange)

    asyncio.run(session._fetch())

    assert session._cash_account_name == ACCOUNT_IBAN
    assert session._account(ACCOUNT_IBAN)["balance"] == 100.5
    assert session._account(ETF_NAME)["balance"] == 1200.0  # = 10 * 120.0
    assert session._account(ETF_NAME)["isin"] == ISIN
    assert session._account("Some Bond 2030")["balance"] == 985.0  # price is per 100 of face value -> 98.5 / 100 * 1000
    assert session._account("Some Bond 2030")["isin"] == SECOND_ISIN
