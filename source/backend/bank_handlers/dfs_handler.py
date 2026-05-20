from contextlib import contextmanager
from datetime import date
from typing import Any, Iterator

from pytr.event import PPEventType
from requests import HTTPError, Session
from source.backend.bank_handlers.base import (
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.exceptions import InvalidCredentialsError, UnknownInternalError
from source.backend.helpers import epoch_ms_to_date
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)


_VORGANG_TO_EVENT_TYPE: dict[str, PPEventType] = {  # TODO: make own enum
    "Einzahlung": PPEventType.DEPOSIT,
    "Auszahlung": PPEventType.REMOVAL,
}


class _DFSSession(BankSession):
    BASE_URL = "https://www.value-account.eu"

    def __init__(self, username: str, password: str, customer: str):
        super().__init__()

        self.username = username
        self.password = password
        self.customer = customer

        self._login_url = f"{self.BASE_URL}/acapif/portal-{self.customer}/public_login.prt"

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

    def _fetch(self) -> None:
        if self._fetched:
            return
        with Session() as http:
            self._login(http)
            self._initialize_dashboard(http)
            dashboard_snapshot = self._fetch_dashboard_snapshot(http)
            modell_keys_by_account: dict[str, str] = {}

            for modell in dashboard_snapshot["snapshotWidget"]["kontoModellList"]:
                modell_key = modell["modellTech"]
                for fund in modell["aktuellesDecorator"]["kapitalItem"]["delegate"]["kontoDaten"]:
                    fund_name = fund["nameKapitalanlage"]
                    self._accounts[fund_name] = {"balance": float(fund["guthaben"]), "transactions": []}
                    modell_keys_by_account[fund_name] = modell_key

            for modell_key in set(modell_keys_by_account.values()):
                for raw_transaction in self._fetch_transactions(http, modell_key=modell_key):
                    fund_name = raw_transaction["anlage"]
                    if fund_name not in self._accounts:
                        continue  # defensive: skip rows that name an unknown fund
                    vorgang: str = raw_transaction.get("vorgang") or ""
                    amount = float(raw_transaction["betrag"])
                    if vorgang == "Auszahlung":
                        amount = -amount
                    self._accounts[fund_name]["transactions"].append(
                        FetchedTransaction(
                            amount=amount,
                            purpose=raw_transaction.get("lohnart"),
                            date=epoch_ms_to_date(raw_transaction["belegdatum"]),
                            other_party=None,
                            portfolio_transaction_type=_VORGANG_TO_EVENT_TYPE.get(vorgang),
                        )
                    )
        self._fetched = True
        logger.debug(
            f"DFS fetched {len(self._accounts)} fund account(s), "
            f"{sum(len(state['transactions']) for state in self._accounts.values())} transaction(s) in total"
        )

    def _login(self, http: Session) -> None:
        login_data = {
            "benutzername": self.username,
            "passwort": self.password,
            "return_url": self._login_url,  # Required to catch invalid credentials
        }
        response = http.post(f"{self.BASE_URL}/ssoportal/login.action", data=login_data)
        # Always returns a 200, even if login failed
        if response.url.startswith(self._login_url):
            error_message = f"DFS login failed: invalid credentials for {self.username}"
            logger.warning(error_message)
            raise InvalidCredentialsError(error_message)
        logger.debug(f"DFS login succeeded for user {self.username}")

    def _initialize_dashboard(self, http: Session) -> None:
        response = http.get(f"{self.BASE_URL}/acaphc/Dashboard.action")
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"Failed to initialize DFS dashboard: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message) from e

    def _fetch_dashboard_snapshot(self, http: Session) -> dict:
        response = http.post(f"{self.BASE_URL}/acaphc/rest/dashboard/getDashboardSnapshot")
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"Failed to load DFS dashboard snapshot: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message) from e
        return response.json()

    def _fetch_transactions(self, http: Session, modell_key: str) -> list[dict]:
        response = http.post(f"{self.BASE_URL}/acaphc/rest/konto/{modell_key}/transaktionen")
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"Failed to load DFS transactions for {modell_key}: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message) from e
        return response.json()["daten"]["grid"]["dataSource"]


class DFSHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password", "customer")

    @contextmanager
    def session(self) -> Iterator[_DFSSession]:
        yield _DFSSession(
            username=self.credentials["username"],
            password=self.credentials["password"],
            customer=self.credentials["customer"],
        )
