import asyncio
import base64
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

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
from source.backend.exceptions import ReauthenticationRequiredError
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.banking import trade_republic_login
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    CHALLENGE_TOKEN,
    CREDENTIAL_ID,
    DEFAULT_AMOUNT,
    DEFAULT_BALANCE,
    ETF_NAME,
    EURO,
    EXCHANGE,
    ISIN,
    LATEST_DATE,
    OLDER_DATE,
    PERSON_NAME,
    PHONE_NUMBER,
    PIN,
    POSITION_NAME,
    RECENT_DATE,
    REFRESHED_COOKIES,
    SECOND_ISIN,
    SHARE_COUNT,
    SHARE_PRICE,
    SOLD_ISIN,
    STORED_COOKIES,
    TWO_FACTOR_CODE,
    assert_log_contains,
)


def test_information_for_user_exposes_phone_and_pin_field_rules():
    rules = BANKS_BY_NAME["trade_republic"].information_for_user["field_rules"]

    assert rules["phone"]["strip_whitespace"] is True
    assert not rules["pin"]["strip_whitespace"]
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


class _FakeClient:
    def settings(self) -> dict:
        return {"securitiesAccountNumber": "SEC-ACC-1"}

    async def close(self) -> None:  # noqa: ASYNC124
        pass


def _session() -> _TradeRepublicSession:
    session = _TradeRepublicSession(trade_republic_client=_FakeClient())
    session._cash_account_name = ACCOUNT_IBAN
    session._account(ACCOUNT_IBAN)
    session._account(ETF_NAME)["isin"] = ISIN
    session._savings_plans = []  # avoid the live savingsPlans fetch; savings-plan projection is tested separately
    return session


def test_cash_and_position_transactions_are_routed_to_the_right_account(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {"date": "2026-05-13", "type": "Removal", "value": -500.0, "note": PERSON_NAME, "isin": None},
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


def test_transactions_are_imported_oldest_first_although_the_timeline_comes_newest_first(
    monkeypatch: pytest.MonkeyPatch,
):
    rows = [
        {
            "timestamp": "2026-05-13T15:00:00.000+0000",
            "date": "2026-05-13",
            "type": "Buy",
            "value": -600.0,
            "note": ETF_NAME,
            "isin": ISIN,
        },
        {
            "timestamp": "2026-05-13T09:00:00.000+0000",
            "date": "2026-05-13",
            "type": "Deposit",
            "value": 1000.0,
            "note": PERSON_NAME,
            "isin": None,
        },
    ]
    _patch_pytr(monkeypatch=monkeypatch, rows=rows, captured={})
    session = _session()

    cash = session.get_transactions(FetchedAccount(name=ACCOUNT_IBAN), start_date=date(year=2026, month=1, day=1))

    assert [t.transaction_type for t in cash] == [TransactionType.DEPOSIT, TransactionType.BUY]


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

    series = _TradeRepublicSession._build_daily_market_value_history(
        name="World", isin=ISIN, moves=moves, prices=prices
    )

    assert [(observation.date, observation.amount) for observation in series] == [
        (date(year=2025, month=3, day=24), 1000.0),
        (date(year=2025, month=3, day=25), 1100.0),
        (date(year=2025, month=4, day=1), 1800.0),
    ]


def test_value_series_logs_debug_summary(caplog: pytest.LogCaptureFixture):
    moves = [(date(year=2025, month=3, day=24), 10.0)]
    prices = {date(year=2025, month=3, day=24): 100.0}

    with caplog.at_level(logging.DEBUG):
        _TradeRepublicSession._build_daily_market_value_history(name="World", isin=ISIN, moves=moves, prices=prices)

    assert_log_contains(caplog, message="valued World")


def test_value_series_without_prices_is_empty():
    moves = [(date(year=2025, month=3, day=24), 10.0)]

    assert (
        _TradeRepublicSession._build_daily_market_value_history(name="World", isin=ISIN, moves=moves, prices={}) == []
    )


def test_market_value_history_is_empty_for_cash_account():
    session = _session()

    assert session.get_market_value_history(FetchedAccount(name=ACCOUNT_IBAN)) == []


def test_market_value_history_is_fetched_once_and_cached(monkeypatch: pytest.MonkeyPatch):
    session = _session()
    calls = {"count": 0}
    expected = [BalanceObservation(date=date(year=2025, month=3, day=24), amount=DEFAULT_AMOUNT)]

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

    challenge = _handler().begin_two_factor_challenge(credential_id=CREDENTIAL_ID)

    assert challenge == TwoFactorChallenge(challenge_token=CHALLENGE_TOKEN, expires_at=expires_at)
    assert calls == [{"credential_id": CREDENTIAL_ID, "phone_no": PHONE_NUMBER, "pin": PIN}]


def test_complete_two_factor_challenge_returns_session_state(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict] = []

    def fake_complete(challenge_token: str, credential_id: int, code: str) -> str:
        calls.append({"challenge_token": challenge_token, "credential_id": credential_id, "code": code})
        return REFRESHED_COOKIES

    monkeypatch.setattr(target=trade_republic_login, name="complete", value=fake_complete)

    session_state = _handler().complete_two_factor_challenge(
        challenge_token=CHALLENGE_TOKEN, credential_id=CREDENTIAL_ID, code=TWO_FACTOR_CODE
    )

    assert session_state == {"cookies": REFRESHED_COOKIES}
    assert calls == [{"challenge_token": CHALLENGE_TOKEN, "credential_id": CREDENTIAL_ID, "code": TWO_FACTOR_CODE}]


class _ResumingApi:
    cookie_files: list[Path] = []

    def __init__(self, cookies_file: str, **kwargs: object) -> None:
        self._cookies_file = Path(cookies_file)
        self.cookie_files.append(self._cookies_file)

    def resume_websession(self) -> bool:
        assert self._cookies_file.read_text() == STORED_COOKIES
        self._cookies_file.write_text(REFRESHED_COOKIES)
        return True


def test_resumed_session_writes_the_refreshed_cookies_back(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=_ResumingApi, name="cookie_files", value=[])
    monkeypatch.setattr(target=trade_republic_login, name="TradeRepublicApi", value=_ResumingApi)
    handler = _handler()
    handler.session_state = {"cookies": STORED_COOKIES}

    with handler.session() as session:
        assert isinstance(session, _TradeRepublicSession)

    assert handler.session_state == {"cookies": REFRESHED_COOKIES}
    assert not any(cookies_file.exists() for cookies_file in _ResumingApi.cookie_files)


def _failing_resume(self: _ResumingApi) -> bool:
    raise ConnectionError()


@pytest.mark.parametrize(
    argnames=("resume_websession", "session_state"),
    argvalues=[
        (lambda self: False, {"cookies": STORED_COOKIES}),
        (_failing_resume, {"cookies": STORED_COOKIES}),
        (None, None),
    ],
)
def test_session_that_cannot_be_resumed_requires_reauthentication(
    monkeypatch: pytest.MonkeyPatch, resume_websession: object, session_state: dict | None
):
    monkeypatch.setattr(target=_ResumingApi, name="resume_websession", value=resume_websession)
    monkeypatch.setattr(target=trade_republic_login, name="TradeRepublicApi", value=_ResumingApi)
    handler = _handler()
    handler.session_state = session_state

    with pytest.raises(ReauthenticationRequiredError, match="2FA re-authentication required"):
        with handler.session():
            pass


class _FakeWebsocketClient(_FakeClient):
    def __init__(self, responses: dict[str, object], settings: dict | None = None) -> None:
        self._responses = responses
        self._settings = settings
        self._inbox: list[tuple[int, dict, object]] = []
        self.subscriptions: list[dict] = []
        self.unsubscribed: list[int] = []

    def settings(self) -> dict:
        return super().settings() if self._settings is None else self._settings

    async def subscribe(self, payload: dict) -> int:  # noqa: ASYNC124
        self.subscriptions.append(payload)
        subscription_id = len(self.subscriptions)
        self._inbox.append((subscription_id, {"type": "ticker"}, {}))
        self._inbox.append((subscription_id, payload, self._responses[payload["type"]]))
        return subscription_id

    async def recv(self) -> tuple[int, dict, object]:  # noqa: ASYNC124
        return self._inbox.pop(0)

    async def unsubscribe(self, subscription_id: int) -> None:  # noqa: ASYNC124
        self.unsubscribed.append(subscription_id)


def _utc_epoch_ms(day: date) -> int:
    return int(datetime.combine(date=day, time=datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000)


@pytest.mark.parametrize(
    argnames="exchange_ids, expected_exchange",
    argvalues=[([EXCHANGE], EXCHANGE), ([], trade_republic._DEFAULT_EXCHANGE)],
)
def test_market_value_history_values_the_holding_with_the_daily_close(
    monkeypatch: pytest.MonkeyPatch, exchange_ids: list[str], expected_exchange: str
):
    client = _FakeWebsocketClient(
        responses={
            "instrument": {"exchangeIds": exchange_ids},
            trade_republic._PRICE_HISTORY_TOPIC: {
                "aggregates": [{"time": _utc_epoch_ms(OLDER_DATE), "close": str(SHARE_PRICE)}]
            },
        }
    )
    session = _TradeRepublicSession(trade_republic_client=client)
    session._account(ETF_NAME)["isin"] = ISIN
    session._account(POSITION_NAME)["isin"] = SECOND_ISIN
    session._share_moves = {ISIN: [(OLDER_DATE, SHARE_COUNT)]}

    history = session.get_market_value_history(FetchedAccount(name=ETF_NAME))

    assert history == [BalanceObservation(date=OLDER_DATE, amount=SHARE_COUNT * SHARE_PRICE)]
    assert session.get_market_value_history(FetchedAccount(name=POSITION_NAME)) == []
    price_subscription = client.subscriptions[-1]
    assert price_subscription["id"] == f"{ISIN}.{expected_exchange}"
    assert client.unsubscribed == list(range(1, len(client.subscriptions) + 1))


def test_market_value_history_of_a_sold_out_position_is_zero_from_its_last_move_on():
    client = _FakeWebsocketClient(
        responses={
            "instrument": {"exchangeIds": [EXCHANGE]},
            trade_republic._PRICE_HISTORY_TOPIC: {
                "aggregates": [
                    {"time": _utc_epoch_ms(day), "close": str(SHARE_PRICE)}
                    for day in (OLDER_DATE, RECENT_DATE, LATEST_DATE)
                ]
            },
        }
    )
    session = _TradeRepublicSession(trade_republic_client=client)
    session._account(POSITION_NAME).update(isin=SOLD_ISIN, closed=True)
    session._share_moves = {SOLD_ISIN: [(OLDER_DATE, SHARE_COUNT * 2), (RECENT_DATE, -SHARE_COUNT)]}

    history = session.get_market_value_history(FetchedAccount(name=POSITION_NAME))

    assert history == [
        BalanceObservation(date=OLDER_DATE, amount=SHARE_COUNT * 2 * SHARE_PRICE),
        BalanceObservation(date=RECENT_DATE, amount=0.0),
        BalanceObservation(date=LATEST_DATE, amount=0.0),
    ]


def test_market_value_history_without_positions_skips_the_websocket():
    client = _FakeWebsocketClient(responses={})
    session = _TradeRepublicSession(trade_republic_client=client)
    session._account(ACCOUNT_IBAN)

    assert asyncio.run(session._fetch_value_history()) == {}
    assert client.subscriptions == []


def test_savings_plans_are_fetched_lazily_and_incomplete_plans_are_skipped(monkeypatch: pytest.MonkeyPatch):
    _patch_pytr(monkeypatch=monkeypatch, rows=[], captured={})
    plan = {"instrumentId": ISIN, "amount": DEFAULT_AMOUNT, "nextExecutionDate": LATEST_DATE.isoformat()}
    incomplete_plan = {"instrumentId": ISIN, "amount": None, "nextExecutionDate": LATEST_DATE.isoformat()}
    client = _FakeWebsocketClient(responses={"savingsPlans": {"savingsPlans": [plan, incomplete_plan]}})
    session = _TradeRepublicSession(trade_republic_client=client)
    session._account(ETF_NAME)["isin"] = ISIN

    position = session.get_transactions(FetchedAccount(name=ETF_NAME), start_date=OLDER_DATE)

    assert [(t.amount, t.pending, t.date) for t in position] == [(-DEFAULT_AMOUNT, True, LATEST_DATE)]
    assert [subscription["type"] for subscription in client.subscriptions] == ["savingsPlans"]


def test_portfolio_without_a_securities_account_number_requires_reauthentication():
    session = _TradeRepublicSession(trade_republic_client=_FakeWebsocketClient(responses={}, settings={}))

    with pytest.raises(ReauthenticationRequiredError, match="securities account number"):
        asyncio.run(session._fetch_positions())


def test_balance_is_the_fetched_account_balance():
    session = _session()
    session._account(ACCOUNT_IBAN)["balance"] = DEFAULT_BALANCE

    assert session.get_balance(FetchedAccount(name=ACCOUNT_IBAN)) == DEFAULT_BALANCE


def _cookies_with_refresh_token(token: str) -> dict:
    return {"cookies": f"# Netscape HTTP Cookie File\napi.traderepublic.com\tFALSE\t/\tTRUE\t0\ttr_refresh\t{token}\n"}


def _jwt(exp: float) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"exp": int(exp)}).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


@pytest.mark.parametrize(
    argnames=("session_state", "expected"),
    argvalues=[
        (_cookies_with_refresh_token(_jwt(exp=time.time() + 3600)), True),
        (_cookies_with_refresh_token(_jwt(exp=time.time() - 60)), False),
        (None, True),
    ],
)
def test_resumes_session_unattended_until_the_refresh_token_expires(session_state: dict | None, expected: bool):
    assert TradeRepublicHandler.resumes_session_unattended(session_state) is expected


@pytest.mark.parametrize(
    argnames=("session_state", "log_message"),
    argvalues=[
        (
            _cookies_with_refresh_token("not-a-jwt"),
            'Could not read the expiry of the Trade Republic "tr_refresh" token',
        ),
        (
            {"cookies": "# Netscape HTTP Cookie File\napi.traderepublic.com\tFALSE\t/\tTRUE\t0\ttr_session\tvalue\n"},
            'Stored Trade Republic cookies hold no "tr_refresh" token',
        ),
        ({"cookies": "not a cookie file"}, "Could not parse the stored Trade Republic cookies"),
    ],
)
def test_resumes_session_unattended_warns_and_tries_anyway_when_the_expiry_is_unreadable(
    session_state: dict, log_message: str, caplog: pytest.LogCaptureFixture
):
    assert TradeRepublicHandler.resumes_session_unattended(session_state) is True
    assert_log_contains(caplog, message=log_message)


def test_fetch_values_positions_via_ticker_and_routes_cash(monkeypatch: pytest.MonkeyPatch):
    session = _TradeRepublicSession(trade_republic_client=_FakeClient())

    async def fake_subscribe_once(payload: dict, expected_type: str):  # noqa: ASYNC124
        if expected_type == "cash":
            return [{"accountNumber": ACCOUNT_IBAN, "currencyId": EURO, "amount": 100.5}]
        if expected_type == "compactPortfolioByType":
            return {
                "categories": [
                    {
                        "categoryType": "stocksAndETFs",
                        "positions": [
                            {"isin": ISIN, "name": ETF_NAME, "netSize": str(SHARE_COUNT), "bondInfo": None},
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
            price = {f"{ISIN}.{EXCHANGE}": str(SHARE_PRICE), f"{SECOND_ISIN}.{EXCHANGE}": "98.5"}[payload["id"]]
            return {"last": {"price": price}}
        raise AssertionError(f"unexpected topic {expected_type}")

    async def fake_instrument_exchange(isin: str) -> str:  # noqa: ASYNC124
        return EXCHANGE

    monkeypatch.setattr(target=session, name="_subscribe_once", value=fake_subscribe_once)
    monkeypatch.setattr(target=session, name="_instrument_exchange", value=fake_instrument_exchange)
    rows = [
        {"date": OLDER_DATE.isoformat(), "type": "Buy", "isin": ISIN, "shares": str(SHARE_COUNT)},
        {"date": OLDER_DATE.isoformat(), "type": "Buy", "isin": SOLD_ISIN, "shares": str(SHARE_COUNT)},
        {"date": RECENT_DATE.isoformat(), "type": "Sell", "isin": SOLD_ISIN, "shares": str(SHARE_COUNT)},
    ]
    _patch_pytr(monkeypatch=monkeypatch, rows=rows, captured={})
    monkeypatch.setattr(
        target=session, name="_instrument_titles", value=lambda events: {ISIN: ETF_NAME, SOLD_ISIN: POSITION_NAME}
    )

    asyncio.run(session._fetch())

    assert session._cash_account_name == ACCOUNT_IBAN
    assert session._account(ACCOUNT_IBAN)["balance"] == 100.5
    assert session._account(ETF_NAME)["balance"] == SHARE_COUNT * SHARE_PRICE
    assert session._account(ETF_NAME)["isin"] == ISIN
    assert session._account(ETF_NAME)["closed"] is False
    assert session._account("Some Bond 2030")["balance"] == 985.0  # price is per 100 of face value -> 98.5 / 100 * 1000
    assert session._account("Some Bond 2030")["isin"] == SECOND_ISIN
    assert session._account(POSITION_NAME) == {"balance": 0.0, "transactions": [], "isin": SOLD_ISIN, "closed": True}
    assert session._share_moves[SOLD_ISIN] == [(OLDER_DATE, SHARE_COUNT), (RECENT_DATE, -SHARE_COUNT)]


def test_sold_out_position_named_like_a_held_one_gets_its_isin_appended(monkeypatch: pytest.MonkeyPatch):
    session = _TradeRepublicSession(trade_republic_client=_FakeClient())

    async def fake_subscribe_once(payload: dict, expected_type: str):  # noqa: ASYNC124
        if expected_type == "cash":
            return [{"accountNumber": ACCOUNT_IBAN, "amount": 0}]
        return {"categories": [{"positions": [{"isin": ISIN, "name": ETF_NAME, "netSize": "0"}]}]}

    async def fake_position_net_value(position: dict) -> float:  # noqa: ASYNC124
        return SHARE_COUNT * SHARE_PRICE

    monkeypatch.setattr(target=session, name="_subscribe_once", value=fake_subscribe_once)
    monkeypatch.setattr(target=session, name="_position_net_value", value=fake_position_net_value)
    _patch_pytr(
        monkeypatch=monkeypatch,
        rows=[{"date": OLDER_DATE.isoformat(), "type": "Buy", "isin": SOLD_ISIN, "shares": str(SHARE_COUNT)}],
        captured={},
    )
    monkeypatch.setattr(target=session, name="_instrument_titles", value=lambda events: {SOLD_ISIN: ETF_NAME})

    asyncio.run(session._fetch())

    assert session._account(ETF_NAME)["isin"] == ISIN
    assert session._account(f"{ETF_NAME} ({SOLD_ISIN})")["isin"] == SOLD_ISIN


def test_get_accounts_marks_sold_out_positions_as_closed(monkeypatch: pytest.MonkeyPatch):
    session = _session()
    session._account(POSITION_NAME).update(isin=SOLD_ISIN, closed=True)

    async def _noop() -> None:
        pass

    monkeypatch.setattr(target=session, name="_fetch", value=_noop)

    closed = {account.external_id: account.is_closed for account in session.get_accounts()}
    assert closed == {ACCOUNT_IBAN: False, ISIN: False, SOLD_ISIN: True}


def test_instrument_titles_maps_each_isin_to_its_newest_title(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        target=trade_republic.Event, name="from_dict", value=staticmethod(lambda raw: SimpleNamespace(**raw))
    )
    events = [  # newest first, like the timeline
        {"isin": ISIN, "title": ETF_NAME},
        {"isin": ISIN, "title": POSITION_NAME},
        {"isin": None, "title": PERSON_NAME},  # cash event
        {"isin": SOLD_ISIN, "title": None},
    ]

    assert _TradeRepublicSession._instrument_titles(events) == {ISIN: ETF_NAME}


def test_project_savings_plans_next_buy():
    plans = [
        {"instrumentId": ISIN, "amount": DEFAULT_AMOUNT, "nextExecutionDate": "2026-09-15"},
        {"instrumentId": ISIN, "amount": 99.0, "nextExecutionDate": "2026-09-15", "paused": True},  # skipped
        {"instrumentId": SECOND_ISIN, "amount": 10.0, "nextExecutionDate": "2026-09-15"},  # other instrument
    ]

    projected = trade_republic._project_savings_plans(plans=plans, isin=ISIN)

    assert [(t.amount, t.date) for t in projected] == [(-50.0, date(year=2026, month=9, day=15))]
    assert all(t.pending and t.transaction_type == TransactionType.BUY for t in projected)


def test_get_transactions_appends_savings_plan_buys_only_to_the_position_account(monkeypatch: pytest.MonkeyPatch):
    _patch_pytr(monkeypatch=monkeypatch, rows=[], captured={})
    session = _session()
    session._savings_plans = [{"instrumentId": ISIN, "amount": DEFAULT_AMOUNT, "nextExecutionDate": "2026-09-15"}]

    cash = session.get_transactions(FetchedAccount(name=ACCOUNT_IBAN), start_date=date(year=2025, month=1, day=1))
    position = session.get_transactions(FetchedAccount(name=ETF_NAME), start_date=date(year=2025, month=1, day=1))

    assert cash == []
    assert [(t.amount, t.pending, t.date) for t in position] == [(-50.0, True, date(year=2026, month=9, day=15))]
