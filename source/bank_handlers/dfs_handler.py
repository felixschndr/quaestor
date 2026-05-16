from contextlib import contextmanager
from typing import Iterator

from requests import HTTPError, Session
from source.bank_handlers.base import BankHandler, BankSession, FetchedAccount
from source.exceptions import InvalidCredentialsError, UnknownInternalError


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
        return accounts

    def get_balance(self, account: FetchedAccount) -> float:
        return self._account_mapping[account.name]["aktuellesDecorator"]["kapitalItem"]["guthaben"]

    def _get_content(self) -> dict:
        session = Session()
        self._login(session)
        self._initialize_dashboard(session)

        return self._get_dashboard_snapshot(session)

    def _login(self, session: Session) -> None:
        login_data = {
            "benutzername": self.username,
            "passwort": self.password,
            "return_url": self._login_url,  # Required to catch invalid credentials
        }
        response = session.post(
            f"{self.BASE_URL}/ssoportal/login.action",
            data=login_data,
        )
        # Always returns a 200, even if login failed
        if response.url.startswith(self._login_url):
            raise InvalidCredentialsError(f"Invalid credentials for {self.username}")

    def _initialize_dashboard(self, session: Session) -> None:
        response = session.get(f"{self.BASE_URL}/acaphc/Dashboard.action")
        try:
            response.raise_for_status()
        except HTTPError as e:
            raise UnknownInternalError(f"Failed to initialize dashboard: {e}")

    def _get_dashboard_snapshot(self, session: Session) -> dict:
        response = session.post(f"{self.BASE_URL}/acaphc/rest/dashboard/getDashboardSnapshot")
        try:
            response.raise_for_status()
        except HTTPError as e:
            raise UnknownInternalError(f"Failed to load dashboard: {e}")

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
