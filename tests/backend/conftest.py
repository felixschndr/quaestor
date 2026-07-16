import logging
from contextlib import contextmanager
from datetime import date as _date
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from unittest.mock import AsyncMock, MagicMock

import pyotp
import pytest
import requests
from fastapi.testclient import TestClient
from httpx import Response  # noqa ASYNC127
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from source.backend import main
from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider
from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.db import get_session
from source.backend.helpers import get_root_path_of_repository, utc_now
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_balance_snapshot import (
    AccountBalanceSnapshot,
)
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.base import Base
from source.backend.models.contracts.contract import Contract
from source.backend.models.contracts.contract_frequency import ContractFrequency
from source.backend.models.contracts.contract_source import ContractSource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.security import csrf, rate_limit
from source.backend.services.banking import bank_catalog, enable_banking_catalog
from source.backend.services.core import i18n_service

USER_NAME = "alice"
SECOND_USER_NAME = "bob"
DISPLAY_NAME = "Alice"
VALID_PASSWORD = "Sup3rSecret!Pass with Spaces"  # nosec B105
VALID_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$SHe1II5FiMI7z+lVd6e6Ig$+liPtR4Uu7MjpiMGPMLmkvmaWai+KehP9tPOmQllTfE"  # nosec B105
)
NEW_VALID_PASSWORD = "BrandNewPa55word!"  # nosec B105
WRONG_PASSWORD = "Wr0ngPassword!!"  # nosec B105
PHONE_NUMBER = "+491234567890"
PIN = "1234"
TWO_FACTOR_CODE = "4321"
HTTP_SESSION_TOKEN = "eyJ_test_token_payload"  # nosec B105
CHALLENGE_TOKEN = "challenge-token"  # nosec B105
BANK_USERNAME = "bankuser"
BANK_PASSWORD = "bankpass"  # nosec B105
ACCOUNT_IBAN = "DE12 3456 7890"
SECOND_ACCOUNT_IBAN = "DE98 7654 3210"
APPLICATION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SESSION_ID = "11111111-2222-3333-4444-555555555555"
ACCOUNT_UID = "99999999-8888-7777-6666-555555555555"
ISIN = "IE00B4L5Y983"
SECOND_ISIN = "US6311031081"
ETF_NAME = "Core MSCI World USD (Acc)"
LAST_FETCHING_TIMESTAMP = datetime(year=2026, month=1, day=1)
OLDER_DATE = _date(year=2026, month=3, day=30)
RECENT_DATE = _date(year=2026, month=4, day=29)
LATEST_DATE = _date(year=2026, month=6, day=1)
AMOUNT = 4000
TWO_FACTOR_SECRET = "T2UXK5D6ZPTJ3WF2YXHYGGXKIT2G5LUH"  # nosec B105  # gitleaks:allow
UNKNOWN_TRANSACTION_OTHER_PARTY = "Some random other party"


def date_to_epoch_ms(day: _date) -> int:
    return int(datetime(year=day.year, month=day.month, day=day.day, tzinfo=timezone.utc).timestamp() * 1000)


OLDER_DATE_MS = date_to_epoch_ms(OLDER_DATE)
RECENT_DATE_MS = date_to_epoch_ms(RECENT_DATE)
LATEST_DATE_MS = date_to_epoch_ms(LATEST_DATE)


@pytest.fixture(scope="session", autouse=True)
def silence_application_log_output():
    root = logging.getLogger()
    for handler in [handler for handler in root.handlers if not type(handler).__module__.startswith("_pytest")]:
        root.removeHandler(handler)


@pytest.fixture(autouse=True)
def clear_display_timezone(monkeypatch: pytest.MonkeyPatch):
    # The app validates DISPLAY_TIMEZONE on startup (and the http_client fixture
    # boots the app). Clear it by default so a developer's local .env can't make
    # the suite depend on ambient config; tests that care set it explicitly.
    monkeypatch.delenv(i18n_service.DISPLAY_TIMEZONE_ENV_VARIABLE_NAME, raising=False)


@pytest.fixture(autouse=True)
def disable_background_tasks(monkeypatch: pytest.MonkeyPatch):
    for module, name in main.STARTUP_BACKGROUND_TASKS:
        monkeypatch.setattr(target=module, name=name, value=AsyncMock())
    monkeypatch.setattr(target=main.migrations, name="upgrade_to_head", value=MagicMock())


@pytest.fixture(autouse=True)
def skip_browser_provisioning(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    # The app lifespan provisions the Playwright browser on startup, which would launch the driver
    # and possibly download Chromium over the network. The dedicated playwright_browser tests opt
    # out via this marker to exercise the real logic.
    if request.node.get_closest_marker("real_playwright_browser"):
        return
    monkeypatch.setattr(target=main.playwright_browser, name="ensure_chromium_installed", value=AsyncMock())


@pytest.fixture(autouse=True)
def isolate_bank_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=enable_banking_catalog, name="_aspsps", value=[])
    monkeypatch.setattr(
        target=enable_banking_catalog, name="ENABLE_BANKING_ASPSPS_PATH", value=tmp_path / "aspsps.json"
    )
    monkeypatch.setattr(target=enable_banking_catalog, name="_fetch", value=lambda: [])
    bank_catalog.invalidate_catalog_cache()
    yield
    bank_catalog.invalidate_catalog_cache()


@pytest.fixture(autouse=True)
def isolate_rate_limiter(monkeypatch: pytest.MonkeyPatch):
    # Each test gets a fresh limiter instance so request counts don't leak across tests.
    monkeypatch.setattr(target=rate_limit, name="limiter", value=rate_limit.InMemoryTokenBucketLimiter())


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def http_client(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    def override_get_session():
        with session_factory() as session:
            yield session

    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    main.app.dependency_overrides[get_session] = override_get_session
    with TestClient(main.app) as test_client:
        # Mimic what a real SPA does: prime the csrf_token cookie via a GET, then echo it
        # back in the X-CSRF-Token header on every subsequent request. Without this every
        # POST/PATCH/PUT/DELETE in the test suite would 403 on the CSRF middleware.
        test_client.get("/api/settings")
        csrf_token = test_client.cookies.get(csrf.COOKIE_NAME)
        if csrf_token:
            test_client.headers[csrf.HEADER_NAME] = csrf_token
        yield test_client
    main.app.dependency_overrides.clear()


@pytest.fixture
def http_client_logged_out(http_client: TestClient) -> TestClient:
    register(http_client)
    http_client.cookies.delete("session")
    return http_client


def register(
    http_client: TestClient,
    user_name: str = USER_NAME,
    display_name: str = DISPLAY_NAME,
    password: str = VALID_PASSWORD,
) -> Response:
    return http_client.post(
        "/api/auth/register", json={"user_name": user_name, "display_name": display_name, "password": password}
    )


def register_and_get_id(
    http_client: TestClient,
    user_name: str = USER_NAME,
    display_name: str = DISPLAY_NAME,
    password: str = VALID_PASSWORD,
) -> int:
    return register(http_client, user_name=user_name, display_name=display_name, password=password).json()["id"]


def login_as(http_client: TestClient, user_name: str, password: str = VALID_PASSWORD) -> Response:
    # Drop only the session cookie; the csrf_token must stay so the POST is accepted.
    http_client.cookies.delete("session")
    return http_client.post("/api/auth/login", json={"user_name": user_name, "password": password})


def register_and_login(
    http_client: TestClient,
    user_name: str = USER_NAME,
    display_name: str = DISPLAY_NAME,
    password: str = VALID_PASSWORD,
) -> int:
    user_id = register(http_client, user_name=user_name, display_name=display_name, password=password).json()["id"]
    login_as(http_client, user_name=user_name, password=password)
    return user_id


def current_totp(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def assert_log_contains(
    caplog: pytest.LogCaptureFixture,
    message: str | None = None,
    messages: list[str] | None = None,
    negate: bool = False,
) -> None:
    assert message or messages, "Pass either `message` or `messages`"

    if messages is None:
        messages = [message]

    captured = [record.message for record in caplog.records]
    for expected in messages:
        present = any(expected in record.message for record in caplog.records)
        if negate:
            assert not present, f"Expected no log record containing {expected!r}; captured: {captured}"
        else:
            assert present, f"No log record contains {expected!r}; captured: {captured}"


def enable_two_factor(http_client: TestClient, user_id: int) -> tuple[str, list[str]]:
    secret = http_client.post(f"/api/users/{user_id}/2fa/setup").json()["secret"]
    backup_codes = http_client.post(f"/api/users/{user_id}/2fa/enable", json={"code": current_totp(secret)}).json()[
        "backup_codes"
    ]
    return secret, backup_codes


def create_api_key(http_client: TestClient) -> Response:
    return http_client.post("/api/api_keys", json={"name": "My script"})


def auth_header_for_api_key(raw_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_token}"}


def create_credential(
    http_client: TestClient, bank: str = "fints", credentials: dict[str, str] | None = None
) -> Response:
    if credentials is None:
        credentials = _default_credentials_for(BankProvider(bank))

    return http_client.post("/api/credentials", json={"bank": bank, "credentials": credentials})


def create_manual_credential(http_client: TestClient) -> int:
    return create_credential(http_client, bank="manual", credentials={}).json()["id"]


def create_fetched_transaction(
    amount: float = -12.34,
    purpose: str | None = None,
    date: _date = RECENT_DATE,
    other_party: str | None = None,
    transaction_type: TransactionType | None = TransactionType.OUTGOING,
    pending: bool = False,
    bank_reference: str | None = None,
) -> FetchedTransaction:
    return FetchedTransaction(
        amount=amount,
        purpose=purpose,
        date=date,
        other_party=other_party,
        transaction_type=transaction_type,
        pending=pending,
        bank_reference=bank_reference,
    )


def _default_credentials_for(bank: BankProvider) -> dict[str, str]:
    bank_info = BANKS_BY_NAME[bank.value]
    fields = bank_info.handler.credential_fields(bank_info)
    defaults = {
        "username": BANK_USERNAME,
        "password": BANK_PASSWORD,
        "phone": PHONE_NUMBER,
        "pin": PIN,
        "blz": "50010517",
    }
    return {field: defaults.get(field, f"{field}-value") for field in fields}  # noqa FKA100


def make_user(
    db_session: Session,
    user_name: str = USER_NAME,
    display_name: str = DISPLAY_NAME,
    password_hash: str = VALID_PASSWORD_HASH,
    language: str = "en",
) -> User:
    user = User(user_name=user_name, display_name=display_name, password_hash=password_hash, language=language)
    db_session.add(user)
    db_session.flush()
    return user


def create_user(session_factory: sessionmaker, user_name: str = USER_NAME) -> User:
    with session_factory() as db_session:
        user = make_user(db_session, user_name=user_name)
        db_session.commit()
        db_session.refresh(user)
        return user


def make_credential(
    db_session: Session,
    user_id: int,
    bank: BankProvider = BankProvider.FINTS,
    credentials: dict[str, str] | None = None,
    requires_two_factor_authentication: bool = False,
    sync_enabled: bool = True,
    last_fetching_timestamp: datetime | None = None,
) -> Credential:
    user = db_session.get(entity=User, ident=user_id)
    credential = Credential(
        user=user,
        bank=bank,
        credentials=credentials if credentials is not None else _default_credentials_for(bank),
        requires_two_factor_authentication=requires_two_factor_authentication,
        sync_enabled=sync_enabled,
        last_fetching_timestamp=last_fetching_timestamp,
    )
    db_session.add(credential)
    db_session.flush()
    return credential


def make_account(
    db_session: Session,
    credential_id: int,
    name: str = ACCOUNT_IBAN,
    display_name: str | None = None,
    balance: float = 0.0,
    balance_factor: int = 100,
    is_hidden: bool = False,
) -> Account:
    credential = db_session.get(entity=Credential, ident=credential_id)
    account = Account(
        credential=credential,
        name=name,
        display_name=display_name,
        balance=balance,
        balance_factor=balance_factor,
        is_hidden=is_hidden,
    )
    db_session.add(account)
    db_session.flush()
    return account


def make_transaction(
    db_session: Session,
    account_id: int,
    amount: float = -1.0,
    purpose: str | None = None,
    other_party: str | None = None,
    date: _date = RECENT_DATE,
    transaction_type: TransactionType | None = None,
    category: TransactionCategory = TransactionCategory.UNKNOWN,
    note: str | None = None,
    pending: bool = False,
    expected: bool = False,
    match_tolerance_percent: int | None = None,
) -> Transaction:
    account = db_session.get(entity=Account, ident=account_id)
    transaction = Transaction(
        account=account,
        amount=amount,
        purpose=purpose,
        other_party=other_party,
        date=date,
        transaction_type=transaction_type,
        category=category,
        note=note,
        pending=pending,
        expected=expected,
        match_tolerance_percent=match_tolerance_percent,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def make_contract(
    db_session: Session,
    account_id: int,
    name: str = "Gym",
    source: ContractSource = ContractSource.DETECTED,
    expected_next_date: _date | None = None,
    category: TransactionCategory | None = None,
    median_amount: float | None = None,
    amount_spread: float | None = None,
    frequency: ContractFrequency | None = None,
    interval_days: int | None = None,
    overdue_notified_at: datetime | None = None,
) -> Contract:
    account = db_session.get(entity=Account, ident=account_id)
    contract = Contract(
        account=account,
        name=name,
        source=source,
        created_at=utc_now(),
        expected_next_date=expected_next_date,
        category=category,
        median_amount=median_amount,
        amount_spread=amount_spread,
        frequency=frequency,
        interval_days=interval_days,
        overdue_notified_at=overdue_notified_at,
    )
    db_session.add(contract)
    db_session.flush()
    return contract


def build_contract(frequency: ContractFrequency | None, interval_days: int) -> Contract:
    return Contract(
        id=13,
        account_id=1,
        name="Salary",
        source=ContractSource.DETECTED,
        median_amount=AMOUNT,
        frequency=frequency,
        interval_days=interval_days,
        created_at=RECENT_DATE,
    )


def persist_credential(
    session_factory: sessionmaker,
    user_id: int,
    bank: BankProvider = BankProvider.FINTS,
    credentials: dict[str, str] | None = None,
    requires_two_factor_authentication: bool = False,
    sync_enabled: bool = True,
    last_fetching_timestamp: datetime | None = None,
) -> int:
    with session_factory() as db_session:
        credential = make_credential(
            db_session,
            user_id=user_id,
            bank=bank,
            credentials=credentials,
            requires_two_factor_authentication=requires_two_factor_authentication,
            sync_enabled=sync_enabled,
            last_fetching_timestamp=last_fetching_timestamp,
        )
        db_session.commit()
        return credential.id


def persist_account(
    session_factory: sessionmaker,
    credential_id: int,
    name: str = ACCOUNT_IBAN,
    display_name: str | None = None,
    balance: float = 0.0,
    balance_factor: int = 100,
    is_hidden: bool = False,
) -> int:
    with session_factory() as db_session:
        account = make_account(
            db_session,
            credential_id=credential_id,
            name=name,
            display_name=display_name,
            balance=balance,
            balance_factor=balance_factor,
            is_hidden=is_hidden,
        )
        db_session.commit()
        return account.id


def persist_transaction(
    session_factory: sessionmaker,
    account_id: int,
    amount: float = -1.0,
    purpose: str | None = None,
    other_party: str | None = None,
    date: _date = RECENT_DATE,
    transaction_type: TransactionType | None = None,
    category: TransactionCategory = TransactionCategory.UNKNOWN,
    note: str | None = None,
    pending: bool = False,
    expected: bool = False,
    match_tolerance_percent: int | None = None,
) -> int:
    """Persist a transaction through its own committed session and return its id."""
    with session_factory() as db_session:
        transaction = make_transaction(
            db_session,
            account_id=account_id,
            amount=amount,
            purpose=purpose,
            other_party=other_party,
            date=date,
            transaction_type=transaction_type,
            category=category,
            note=note,
            pending=pending,
            expected=expected,
            match_tolerance_percent=match_tolerance_percent,
        )
        db_session.commit()
        return transaction.id


def persist_credential_with_new_user(
    session_factory: sessionmaker, last_fetching_timestamp: datetime | None = LAST_FETCHING_TIMESTAMP
) -> int:
    """Create a fresh user and a credential owned by them, returning the credential id."""
    user = create_user(session_factory)
    return persist_credential(session_factory, user_id=user.id, last_fetching_timestamp=last_fetching_timestamp)


def persist_account_with_new_user(session_factory: sessionmaker, balance: float = 0.0) -> int:
    credential_id = persist_credential_with_new_user(session_factory, last_fetching_timestamp=None)
    return persist_account(session_factory, credential_id=credential_id, balance=balance)


def make_user_and_credential_and_account(
    db_session: Session,
    user_name: str = USER_NAME,
    bank: BankProvider = BankProvider.FINTS,
    name: str = ACCOUNT_IBAN,
    balance: float = 0.0,
) -> tuple[User, Credential, Account]:
    user = make_user(db_session, user_name=user_name)
    credentials = {} if bank == BankProvider.MANUAL else None
    credential = make_credential(db_session, user_id=user.id, bank=bank, credentials=credentials)
    account = make_account(db_session, credential_id=credential.id, name=name, balance=balance)
    return user, credential, account


def make_account_with_new_user(
    db_session: Session,
    user_name: str = USER_NAME,
    bank: BankProvider = BankProvider.FINTS,
    name: str = ACCOUNT_IBAN,
    balance: float = 0.0,
) -> Account:
    _, _, account = make_user_and_credential_and_account(
        db_session, user_name=user_name, bank=bank, name=name, balance=balance
    )
    return account


def persist_manual_account_with_new_user(session_factory: sessionmaker, balance: float = 100.0) -> int:
    with session_factory() as session:
        account = make_account_with_new_user(session, bank=BankProvider.MANUAL, name="Wallet", balance=balance)
        session.commit()
        return account.id


def setup_account(http_client: TestClient, session_factory: sessionmaker) -> int:
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    return persist_account(session_factory=session_factory, credential_id=credential_id)


def setup_manual_account(http_client: TestClient, balance: float = 100.0) -> int:
    credential_id = create_manual_credential(http_client)
    return http_client.post(
        "/api/account",
        json={"credential_id": credential_id, "name": "Wallet", "balance": balance},
    ).json()["id"]


def seed_for_categories(session_factory: sessionmaker, account_id: int) -> None:
    with session_factory() as session:
        make_transaction(
            session, account_id=account_id, amount=-12.50, other_party="Rewe", category=TransactionCategory.SUPERMARKET
        )
        make_transaction(
            session, account_id=account_id, amount=-7.50, other_party="Edeka", category=TransactionCategory.SUPERMARKET
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-30.00,
            other_party="Pizzeria",
            category=TransactionCategory.RESTAURANTS,
        )
        make_transaction(
            session, account_id=account_id, amount=2500.00, other_party="ACME", category=TransactionCategory.SALARY
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-999.00,
            category=TransactionCategory.SUPERMARKET,
            pending=True,
        )
        session.commit()


def seed_snapshot(session_factory: sessionmaker, account_id: int, day: _date, balance: float) -> None:
    with session_factory() as session:
        session.add(AccountBalanceSnapshot(account_id=account_id, date=day, balance=balance))
        session.commit()


class FakeHttpResponse:
    def __init__(self, url: str = "", text: str = "", json_data: object = None, status_code: int = 200) -> None:
        self.url = url
        self.text = text
        self._json = json_data
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error", response=self)

    def json(self) -> object:
        return self._json


class FakeBankSession(BankSession):
    """In-memory bank session for sync tests: returns canned accounts/balances/transactions."""

    def __init__(
        self,
        accounts: list[FetchedAccount],
        balances: dict[str, float],
        transactions: dict[str, list[FetchedTransaction]],
        observations: dict[str, list[BalanceObservation]] | None = None,
        market_values: dict[str, list[BalanceObservation]] | None = None,
    ) -> None:
        super().__init__()
        self._accounts = accounts
        self._balances = balances
        self._transactions = transactions
        self._observations = observations or {}
        self._market_values = market_values or {}
        self.get_transactions_calls: list[tuple[str, _date]] = []

    def get_accounts(self) -> list[FetchedAccount]:
        return self._accounts

    def get_balance(self, account: FetchedAccount) -> float:
        return self._balances[account.name]

    def get_transactions(self, account: FetchedAccount, start_date: _date) -> list[FetchedTransaction]:
        self.get_transactions_calls.append((account.name, start_date))
        return self._transactions[account.name] if account.name in self._transactions else []

    def get_balance_observations(self, account: FetchedAccount) -> list[BalanceObservation]:
        return self._observations.get(account.name, [])  # noqa: FKA100

    def get_market_value_history(self, account: FetchedAccount) -> list[BalanceObservation]:
        return self._market_values.get(account.name, [])  # noqa: FKA100


def build_handler(bank_session: FakeBankSession) -> MagicMock:
    handler = MagicMock()

    @contextmanager
    def session_cm() -> Iterator[FakeBankSession]:
        yield bank_session

    handler.session.side_effect = session_cm
    return handler


def seed_account_with_expectation(
    session_factory: sessionmaker,
    credential_id: int,
    amount: float,
    tolerance: int,
    other_party: str | None = None,
) -> None:
    with session_factory() as session:
        account = make_account(session, credential_id=credential_id, name=ACCOUNT_IBAN)
        make_transaction(
            session,
            account_id=account.id,
            amount=amount,
            date=OLDER_DATE,
            other_party=other_party,
            note="expected note",
            pending=True,
            expected=True,
            match_tolerance_percent=tolerance,
        )
        session.commit()


def sync_with_booked(session_factory: sessionmaker, credential_id: int, booked: list[FetchedTransaction]) -> None:
    """Sync the credential against a fake bank that returns `booked` for ACCOUNT_IBAN."""
    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 0.0},
            transactions={ACCOUNT_IBAN: booked},
        )
    )
    with session_factory() as session:
        credential = session.get(entity=Credential, ident=credential_id)
        credential.sync(handler)
        session.commit()


def get_backend_test_path() -> Path:
    return get_root_path_of_repository() / "tests" / "backend"
