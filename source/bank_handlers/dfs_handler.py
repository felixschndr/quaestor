import logging
from contextlib import contextmanager
from typing import Iterator

from requests import HTTPError, Session
from source.bank_handlers.base import BankHandler, BankSession, FetchedAccount
from source.exceptions import InvalidCredentialsError, UnknownInternalError

logger = logging.getLogger(__name__)


class _DFSSession(BankSession):
    BASE_URL = "https://www.value-account.eu"

    def __init__(self, username: str, password: str, mandat: str, customer: str):
        super().__init__()

        self.username = username
        self.password = password
        self.mandat = mandat
        self.customer = customer

        self._login_url = f"{self.BASE_URL}/acapif/portal-{self.customer}/public_login.prt"

        self._account_mapping: dict[str, dict]

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = []
        konto_modell_list = self._get_content()["snapshotWidget"]["kontoModellList"]
        for account_raw in konto_modell_list:
            accounts.append(FetchedAccount(name=account_raw["modellName"]))
            self._account_mapping[account_raw["modellName"]] = account_raw
        logger.debug(f"DFS returned {len(accounts)} account(s)")
        return accounts

    def get_balance(self, account: FetchedAccount) -> float:
        return self._account_mapping[account.name]["aktuellesDecorator"]["kapitalItem"]["guthaben"]

    def _get_content(self) -> dict:
        http_session = Session()
        self._login(http_session)
        self._initialize_dashboard(http_session)

        return self._get_dashboard_snapshot(http_session)

    def _login(self, http_session: Session) -> None:
        login_data = {
            "benutzername": self.username,
            "passwort": self.password,
            "return_url": self._login_url,  # Required to catch invalid credentials
        }
        response = http_session.post(
            f"{self.BASE_URL}/ssoportal/login.action",
            data=login_data,
        )
        # Always returns a 200, even if login failed
        if response.url.startswith(self._login_url):
            error_message = f"DFS login failed: invalid credentials for {self.username}"
            logger.warning(error_message)
            raise InvalidCredentialsError(error_message)
        logger.debug(f"DFS login succeeded for user {self.username}")

    def _initialize_dashboard(self, http_session: Session) -> None:
        response = http_session.get(f"{self.BASE_URL}/acaphc/Dashboard.action")
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"Failed to initialize DFS dashboard: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message)

    def _get_dashboard_snapshot(self, http_session: Session) -> dict:
        response = http_session.post(f"{self.BASE_URL}/acaphc/rest/dashboard/getDashboardSnapshot")
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"Failed to load DFS dashboard snapshot: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message)

        return response.json()


class DFSHandler(BankHandler):
    EXTRA_CREDENTIAL_FIELDS = ("mandat", "customer")

    @contextmanager
    def session(self) -> Iterator[_DFSSession]:
        yield _DFSSession(
            username=self.username,
            password=self.password,
            mandat=self.extra["mandat"],
            customer=self.extra["customer"],
        )
