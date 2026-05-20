from datetime import date, datetime

import pytest
from source.backend.bank_handlers import trade_republic
from source.backend.bank_handlers.base import FetchedAccount
from source.backend.bank_handlers.trade_republic import _TradeRepublicSession
from source.backend.models.transaction_type import TransactionType


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
    session._cash_account_name = "DE00 1234"
    session._account("DE00 1234")
    session._account("Core MSCI World USD (Acc)")["isin"] = "IE00B4L5Y983"
    return session


def test_cash_and_position_transactions_are_routed_to_the_right_account(monkeypatch: pytest.MonkeyPatch):
    rows = [
        {"date": "2026-05-13", "type": "Removal", "value": -500.0, "note": "Alice Parker", "isin": None},
        {
            "date": "2025-03-24",
            "type": "Buy",
            "value": -54801.0,
            "note": "Core MSCI World USD (Acc)",
            "isin": "IE00B4L5Y983",
        },
        {"date": "2025-01-01", "type": "Tax Refund", "value": None, "note": "skip me", "isin": None},
    ]
    _patch_pytr(monkeypatch=monkeypatch, rows=rows, captured={})
    session = _session()

    cash = session.get_transactions(FetchedAccount(name="DE00 1234"), start_date=date(year=2025, month=1, day=1))
    position = session.get_transactions(
        FetchedAccount(name="Core MSCI World USD (Acc)"), start_date=date(year=2025, month=1, day=1)
    )

    assert [(t.amount, t.transaction_type, t.date) for t in cash] == [
        (-500.0, TransactionType.REMOVAL, date(year=2026, month=5, day=13))
    ]
    assert [(t.amount, t.transaction_type, t.date) for t in position] == [
        (-54801.0, TransactionType.BUY, date(year=2025, month=3, day=24))
    ]


def test_start_date_is_passed_to_the_timeline_as_not_before(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}
    _patch_pytr(monkeypatch=monkeypatch, rows=[], captured=captured)
    session = _session()

    start_date = date(year=2025, month=3, day=4)
    session.get_transactions(FetchedAccount(name="DE00 1234"), start_date=start_date)

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

    session.get_transactions(FetchedAccount(name="DE00 1234"), start_date=date(year=2025, month=1, day=1))
    session.get_transactions(
        FetchedAccount(name="Core MSCI World USD (Acc)"), start_date=date(year=2025, month=1, day=1)
    )

    assert calls["count"] == 1
