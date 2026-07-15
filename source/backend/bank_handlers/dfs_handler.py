from contextlib import contextmanager
from datetime import date
from typing import Any, Iterator

from requests import HTTPError
from requests.exceptions import JSONDecodeError

from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.exceptions import InvalidCredentialsError, UnknownInternalError
from source.backend.helpers import epoch_ms_to_date, parse_german_decimal
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.rest_api_client import RestAPIClient

logger = get_logger(__name__)


_VORGANG_TO_TRANSACTION_TYPE: dict[str, TransactionType] = {
    "Einzahlung": TransactionType.DEPOSIT,
    "Auszahlung": TransactionType.REMOVAL,
}


class _DFSSession(BankSession):
    BASE_URL = "https://www.value-account.eu"
    CUSTOMER = "dfsbav"

    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password

        self._rest_api_client = RestAPIClient(name="DFS", base_url=self.BASE_URL)
        self._login_url = f"{self.BASE_URL}/acapif/portal-{self.CUSTOMER}/public_login.prt"

        self._accounts: dict[str, dict[str, Any]] = {}
        self._fetched = False

    def get_accounts(self) -> list[FetchedAccount]:
        self._fetch()
        return [FetchedAccount(name=name) for name in self._accounts]

    def get_balance(self, account: FetchedAccount) -> float:
        self._fetch()
        return self._accounts[account.name]["balance"]

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        self._fetch()
        transactions = [
            transaction
            for transaction in self._accounts.get(account.name, {}).get("transactions", [])  # noqa: FKA100
            if transaction.date >= start_date
        ]
        logger.debug(f"DFS returned {len(transactions)} transaction(s) for {account.name} since {start_date}")
        return transactions

    def get_market_value_history(self, account: FetchedAccount) -> list[BalanceObservation]:
        self._fetch()
        state = self._accounts.get(account.name)
        if state is None:
            return []
        return self._market_value_series(
            name=account.name,
            kurs_series=state["kurs_series"],
            units_moves=state["units_moves"],
            transaction_days=[transaction.date for transaction in state["transactions"]],
        )

    def _fetch(self) -> None:
        if self._fetched:
            return
        try:
            self._login()
            self._initialize_dashboard()
            dashboard_snapshot = self._fetch_dashboard_snapshot()
            modell_keys_by_account: dict[str, str] = {}

            for modell in dashboard_snapshot["snapshotWidget"]["kontoModellList"]:
                modell_key = modell["modellTech"]
                for fund in modell["aktuellesDecorator"]["kapitalItem"]["delegate"]["kontoDaten"]:
                    fund_name = fund["nameKapitalanlage"]
                    self._accounts[fund_name] = {
                        "balance": float(fund["guthaben"]),
                        "transactions": [],
                        "units_moves": [],
                        "kurs_series": [],
                    }
                    modell_keys_by_account[fund_name] = modell_key

            for modell_key in set(modell_keys_by_account.values()):
                self._load_kurse_series(modell_key=modell_key)
                for raw_transaction in self._fetch_transactions(modell_key=modell_key):
                    self._record_transaction(raw_transaction)
        except (HTTPError, JSONDecodeError, UnknownInternalError) as e:
            error_message = f"Failed to fetch DFS data: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message) from e
        self._fetched = True
        logger.debug(
            f"DFS fetched {len(self._accounts)} fund account(s), "
            f"{sum(len(state['transactions']) for state in self._accounts.values())} transaction(s) in total"
        )

    def _record_transaction(self, raw_transaction: dict) -> None:
        fund_name = raw_transaction["anlage"]
        if fund_name not in self._accounts:
            return  # defensive: skip rows that name an unknown fund
        vorgang: str = raw_transaction.get("vorgang") or ""
        sign = -1 if vorgang == "Auszahlung" else 1
        self._accounts[fund_name]["transactions"].append(
            FetchedTransaction(
                amount=sign * float(raw_transaction["betrag"]),
                purpose=raw_transaction.get("lohnart"),
                date=epoch_ms_to_date(raw_transaction["belegdatum"]),
                other_party="Deutsche Flugsicherung GmbH",
                transaction_type=_VORGANG_TO_TRANSACTION_TYPE.get(vorgang),
            )
        )
        kaufdatum = epoch_ms_to_date(raw_transaction.get("kaufdatum") or raw_transaction["belegdatum"])
        anteile = sign * parse_german_decimal(raw_transaction["anteile"])
        self._accounts[fund_name]["units_moves"].append((kaufdatum, anteile))

    def _load_kurse_series(self, modell_key: str) -> None:
        for row in self._fetch_kurse_list(modell_key=modell_key):
            fund_name = row["name"]
            if fund_name in self._accounts:
                self._accounts[fund_name]["kurs_series"] = self._fetch_kurse_series(
                    modell_key=modell_key, kurs_id=row["id"]
                )

    @staticmethod
    def _market_value_series(
        name: str,
        kurs_series: list[list],
        units_moves: list[tuple[date, float]],
        transaction_days: list[date],
    ) -> list[BalanceObservation]:
        if not kurs_series:
            logger.debug(f"No price series for {name}; skipping value history")
            return []
        series = sorted((epoch_ms_to_date(epoch_ms), float(kurs)) for epoch_ms, kurs in kurs_series)
        moves = sorted(units_moves)
        if not moves:
            return []

        first_move = moves[0][0]
        valuation_days = sorted({day for day, _ in series} | set(transaction_days))
        held = 0.0
        next_move = 0
        next_price = 0
        kurs = series[0][1]
        observations: list[BalanceObservation] = []
        for day in valuation_days:
            while next_move < len(moves) and moves[next_move][0] <= day:
                held += moves[next_move][1]
                next_move += 1
            while next_price < len(series) and series[next_price][0] <= day:
                kurs = series[next_price][1]
                next_price += 1
            if day >= first_move:
                observations.append(BalanceObservation(date=day, amount=round(number=held * kurs, ndigits=2)))
        logger.debug(f"DFS valued {name}: {len(observations)} daily snapshot(s) from {len(moves)} contribution(s)")
        return observations

    def _login(self) -> None:
        login_data = {
            "benutzername": self.username,
            "passwort": self.password,
            "return_url": self._login_url,  # Required to catch invalid credentials
        }
        response = self._rest_api_client.request(method="POST", path="/ssoportal/login.action", data=login_data)
        # Always returns a 200, even if login failed
        if response.url.startswith(self._login_url):
            error_message = f"DFS login failed: invalid credentials for {self.username}"
            logger.warning(error_message)
            raise InvalidCredentialsError(error_message)
        logger.debug(f"DFS login succeeded for user {self.username}")

    def _initialize_dashboard(self) -> None:
        self._rest_api_client.request(method="GET", path="/acaphc/Dashboard.action").raise_for_status()

    def _fetch_dashboard_snapshot(self) -> dict:
        return self._rest_api_client.post(path="/acaphc/rest/dashboard/getDashboardSnapshot")

    def _fetch_transactions(self, modell_key: str) -> list[dict]:
        return self._rest_api_client.post(path=f"/acaphc/rest/konto/{modell_key}/transaktionen")["daten"]["grid"][
            "dataSource"
        ]

    def _fetch_kurse_list(self, modell_key: str) -> list[dict]:
        # Maps each fund (name + ISIN) to its price-series id, e.g. {"name": ..., "id": "1416:STANDARD_BAV"}.
        return self._rest_api_client.post(path=f"/acaphc/rest/konto/{modell_key}/kurse")["daten"]["rows"]

    def _fetch_kurse_series(self, modell_key: str, kurs_id: str) -> list[list]:
        series = self._rest_api_client.post(path=f"/acaphc/rest/konto/{modell_key}/kurse/{kurs_id}")["series"]
        return series[0]["data"] if series else []


class DFSHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password")

    @contextmanager
    def session(self) -> Iterator[_DFSSession]:
        yield _DFSSession(username=self.credentials["username"], password=self.credentials["password"])
