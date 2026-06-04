import json
import logging
from datetime import date, datetime, timezone

import pytest
import requests
from source.backend.bank_handlers import dfs_handler
from source.backend.bank_handlers.base import BalanceObservation, FetchedAccount
from source.backend.bank_handlers.dfs_handler import DFSHandler, _DFSSession
from source.backend.exceptions import InvalidCredentialsError, UnknownInternalError
from source.backend.helpers import epoch_ms_to_date
from source.backend.models.transaction_type import TransactionType

from tests.backend.conftest import USER_NAME, VALID_PASSWORD, get_backend_test_path

FIXTURES = get_backend_test_path() / "fixtures"
DASHBOARD_SNAPSHOT = json.loads((FIXTURES / "dfs_dashboard_snapshot_response.json").read_text())
TRANSACTIONS = json.loads((FIXTURES / "dfs_transactions_response.json").read_text())

LOGIN_URL = f"{_DFSSession.BASE_URL}/acapif/portal-{_DFSSession.CUSTOMER}/public_login.prt"
DASHBOARD_REDIRECT_URL = f"{_DFSSession.BASE_URL}/acaphc/Dashboard.action"
# 1777500000000 ms ≈ 2026-04-29; 1774908000000 ms ≈ 2026-03-30; 1780272000000 ms ≈ 2026-06-01
RECENT_DATE = epoch_ms_to_date(1777500000000)
OLDER_DATE = epoch_ms_to_date(1774908000000)
LATEST_DATE = epoch_ms_to_date(1780272000000)

# Maps each fund to its price-series id; the series are an index (price per unit) over time.
KURSE_LIST = {
    "daten": {
        "rows": [
            {"id": "1:STANDARD_BAV", "isin": "DE000STOCKA0", "name": "Stock A"},
            {"id": "2:STANDARD_BAV", "isin": "DE000STOCKB0", "name": "Stock B"},
        ]
    }
}
KURSE_SERIES_BY_ID = {
    "1:STANDARD_BAV": {"series": [{"data": [[1774908000000, 35], [1777500000000, 15], [1780272000000, 100]]}]},
    "2:STANDARD_BAV": {"series": [{"data": [[1774908000000, 45], [1777500000000, 25], [1780272000000, 50]]}]},
}


class _FakeResponse:
    def __init__(self, *, url: str = "", json_data: object = None, status_code: int = 200) -> None:
        self.url = url
        self._json = json_data
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error", response=self)

    def json(self) -> object:
        return self._json


class FakeSession:
    def __init__(
        self,
        *,
        login_redirect_url: str = DASHBOARD_REDIRECT_URL,
        dashboard_status: int = 200,
        snapshot_status: int = 200,
        transactions_status: int = 200,
        kurse_list_status: int = 200,
        kurse_series_status: int = 200,
        snapshot_data: dict | None = None,
        transactions_data: dict | None = None,
        kurse_list_data: dict | None = None,
        kurse_series_by_id: dict | None = None,
    ) -> None:
        self.login_redirect_url = login_redirect_url
        self.dashboard_status = dashboard_status
        self.snapshot_status = snapshot_status
        self.transactions_status = transactions_status
        self.kurse_list_status = kurse_list_status
        self.kurse_series_status = kurse_series_status
        self.snapshot_data = snapshot_data if snapshot_data is not None else DASHBOARD_SNAPSHOT
        self.transactions_data = transactions_data if transactions_data is not None else TRANSACTIONS
        self.kurse_list_data = kurse_list_data if kurse_list_data is not None else KURSE_LIST
        self.kurse_series_by_id = kurse_series_by_id if kurse_series_by_id is not None else KURSE_SERIES_BY_ID
        self.calls: list[tuple[str, str, dict]] = []

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *args: object) -> bool:
        return False

    def post(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append(("POST", url, kwargs))
        if "login.action" in url:
            return _FakeResponse(url=self.login_redirect_url)
        if "getDashboardSnapshot" in url:
            return _FakeResponse(status_code=self.snapshot_status, json_data=self.snapshot_data)
        if "/transaktionen" in url:
            return _FakeResponse(status_code=self.transactions_status, json_data=self.transactions_data)
        if "/kurse/" in url:
            kurs_id = url.split("/kurse/")[1]
            return _FakeResponse(status_code=self.kurse_series_status, json_data=self.kurse_series_by_id.get(kurs_id))
        if url.endswith("/kurse"):
            return _FakeResponse(status_code=self.kurse_list_status, json_data=self.kurse_list_data)
        raise AssertionError(f"unexpected POST {url}")

    def get(self, url: str, **kwargs: object) -> _FakeResponse:
        self.calls.append(("GET", url, kwargs))
        if "Dashboard.action" in url:
            return _FakeResponse(status_code=self.dashboard_status)
        raise AssertionError(f"unexpected GET {url}")


def patch_session(monkeypatch: pytest.MonkeyPatch, fake: FakeSession) -> None:
    monkeypatch.setattr(target=dfs_handler, name="Session", value=lambda: fake)


def dfs_session() -> _DFSSession:
    return _DFSSession(username=USER_NAME, password=VALID_PASSWORD)


def test_get_accounts_returns_fund_names_from_dashboard_snapshot(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())

    accounts = dfs_session().get_accounts()

    assert accounts == [FetchedAccount(name="Stock A"), FetchedAccount(name="Stock B")]


def test_get_balance_returns_guthaben_for_account(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())
    session = dfs_session()

    assert session.get_balance(FetchedAccount(name="Stock A")) == 110.0
    assert session.get_balance(FetchedAccount(name="Stock B")) == 220.0


def test_get_transactions_groups_rows_by_fund_and_maps_einzahlung(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())
    session = dfs_session()

    stock_a = session.get_transactions(FetchedAccount(name="Stock A"), start_date=date(year=2020, month=1, day=1))
    stock_b = session.get_transactions(FetchedAccount(name="Stock B"), start_date=date(year=2020, month=1, day=1))

    assert [(t.amount, t.purpose, t.date, t.transaction_type) for t in stock_a] == [
        (10.0, "AG-Beitrag laufend", RECENT_DATE, TransactionType.DEPOSIT),
        (30.0, "AG-Beitrag laufend", OLDER_DATE, TransactionType.DEPOSIT),
    ]
    assert [(t.amount, t.purpose, t.date, t.transaction_type) for t in stock_b] == [
        (20.0, "AG-Beitrag laufend", RECENT_DATE, TransactionType.DEPOSIT),
        (40.0, "AG-Beitrag laufend", OLDER_DATE, TransactionType.DEPOSIT),
    ]


def test_transactions_are_filtered_by_start_date(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())
    session = dfs_session()

    # RECENT_DATE > OLDER_DATE — pick a start_date strictly between them
    between = date.fromordinal(OLDER_DATE.toordinal() + 1)
    transactions = session.get_transactions(FetchedAccount(name="Stock A"), start_date=between)

    assert [t.date for t in transactions] == [RECENT_DATE]


def test_remote_data_is_only_fetched_once(monkeypatch: pytest.MonkeyPatch):
    fake_session = FakeSession()
    patch_session(monkeypatch=monkeypatch, fake=fake_session)
    session = dfs_session()

    session.get_accounts()
    session.get_accounts()
    session.get_balance(FetchedAccount(name="Stock A"))
    session.get_transactions(FetchedAccount(name="Stock A"), start_date=date(year=2020, month=1, day=1))

    assert len([c for c in fake_session.calls if "login.action" in c[1]]) == 1
    assert len([c for c in fake_session.calls if "getDashboardSnapshot" in c[1]]) == 1
    assert len([c for c in fake_session.calls if "/transaktionen" in c[1]]) == 1


def test_invalid_credentials_raise_when_login_redirects_back_to_login(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession(login_redirect_url=LOGIN_URL))

    with pytest.raises(InvalidCredentialsError):
        dfs_session().get_accounts()


@pytest.mark.parametrize(
    argnames="failing_step",
    argvalues=[
        "dashboard_status",
        "snapshot_status",
        "transactions_status",
        "kurse_list_status",
        "kurse_series_status",
    ],
)
def test_http_error_raises_unknown_internal_error(monkeypatch: pytest.MonkeyPatch, failing_step: str):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession(**{failing_step: 500}))

    with pytest.raises(UnknownInternalError):
        dfs_session().get_accounts()


def test_get_market_value_history_values_units_times_index_price(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())
    session = dfs_session()

    history = session.get_market_value_history(FetchedAccount(name="Stock A"))

    # Stock A holds 3 units from OLDER_DATE and 1 more from RECENT_DATE; price index 35 -> 15 -> 100.
    assert [(observation.date, observation.amount) for observation in history] == [
        (OLDER_DATE, 105.0),  # 3 units * 35
        (RECENT_DATE, 60.0),  # 4 units * 15
        (LATEST_DATE, 400.0),  # 4 units * 100
    ]


def test_get_market_value_history_is_empty_without_price_series(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession(kurse_list_data={"daten": {"rows": []}}))

    assert dfs_session().get_market_value_history(FetchedAccount(name="Stock A")) == []


def test_get_market_value_history_logs_debug_summary(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())
    session = dfs_session()

    with caplog.at_level(logging.DEBUG):
        session.get_market_value_history(FetchedAccount(name="Stock A"))

    assert any("valued Stock A" in record.message for record in caplog.records)


def test_market_value_history_returns_balance_observations(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=FakeSession())

    history = dfs_session().get_market_value_history(FetchedAccount(name="Stock A"))

    assert all(isinstance(observation, BalanceObservation) for observation in history)


def _ms(day: date) -> int:
    return int(datetime(year=day.year, month=day.month, day=day.day, tzinfo=timezone.utc).timestamp() * 1000)


def test_value_series_fills_transaction_days_with_carried_forward_price():
    priced_day = date(year=2026, month=5, day=1)
    transaction_day = date(year=2026, month=5, day=3)  # no price point on this day
    later_priced_day = date(year=2026, month=5, day=5)
    kurs_series = [[_ms(priced_day), 10], [_ms(later_priced_day), 20]]

    series = _DFSSession._market_value_series(
        name="Fund",
        kurs_series=kurs_series,
        units_moves=[(priced_day, 2.0)],
        transaction_days=[transaction_day],
    )

    assert [(observation.date, observation.amount) for observation in series] == [
        (priced_day, 20.0),  # 2 units * 10
        (transaction_day, 20.0),  # 2 units * last known price 10 (carried forward)
        (later_priced_day, 40.0),  # 2 units * 20
    ]


def test_login_request_sends_credentials_and_return_url(monkeypatch: pytest.MonkeyPatch):
    fake_session = FakeSession()
    patch_session(monkeypatch=monkeypatch, fake=fake_session)

    dfs_session().get_accounts()

    [login_call] = [call for call in fake_session.calls if "login.action" in call[1]]
    assert login_call[2]["data"] == {
        "benutzername": USER_NAME,
        "passwort": VALID_PASSWORD,
        "return_url": LOGIN_URL,
    }


def test_handler_session_yields_session_with_credentials():
    handler = DFSHandler(
        bank_info=object(),
        credentials={"username": USER_NAME, "password": VALID_PASSWORD},
    )
    with handler.session() as session:
        assert isinstance(session, _DFSSession)
        assert session.username == USER_NAME
        assert session.password == VALID_PASSWORD
        assert _DFSSession.CUSTOMER == "dfsbav"
        assert session._login_url == LOGIN_URL
