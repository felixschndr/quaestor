import os
from datetime import date as _date
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from source.backend import main
from source.backend.bank_handlers import BANKS_BY_NAME, BankProvider
from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.db import get_session
from source.backend.helpers import get_root_path_of_repository
from source.backend.models.account import Account
from source.backend.models.base import Base
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from source.backend.models.user import User
from source.backend.security import csrf, rate_limit
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault(key="ALLOW_MISSING_FRONTEND", value="true")

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
HTTP_SESSION_TOKEN = "eyJ_test_token_payload"  # nosec B105
BANK_USERNAME = "bankuser"
BANK_PASSWORD = "bankpass"  # nosec B105
UNKNOWN_TRANSACTION_OTHER_PARTY = "Some random other party"


@pytest.fixture(autouse=True)
def disable_background_tasks(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=AsyncMock())
    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=AsyncMock())
    monkeypatch.setattr(target=main.migrations, name="upgrade_to_head", value=MagicMock())


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
        test_client.get("/api/auth/registration_allowed")
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


def login_as(http_client: TestClient, user_name: str, password: str = VALID_PASSWORD) -> Response:
    # Drop only the session cookie; the csrf_token must stay so the POST is accepted.
    http_client.cookies.delete("session")
    return http_client.post("/api/auth/login", json={"user_name": user_name, "password": password})


def create_credential(
    http_client: TestClient, bank: str = "ing", credentials: dict[str, str] | None = None
) -> Response:
    if credentials is None:
        credentials = {"username": BANK_USERNAME, "password": BANK_PASSWORD}
    return http_client.post("/api/credentials", json={"bank": bank, "credentials": credentials})


def create_fetched_transaction(
    amount: float = -12.34,
    purpose: str | None = None,
    date: _date = _date(year=2026, month=5, day=21),
    other_party: str | None = None,
    transaction_type: TransactionType | None = TransactionType.OUTGOING,
) -> FetchedTransaction:
    return FetchedTransaction(
        amount=amount,
        purpose=purpose,
        date=date,
        other_party=other_party,
        transaction_type=transaction_type,
    )


def _default_credentials_for(bank: BankProvider) -> dict[str, str]:
    bank_info = BANKS_BY_NAME[bank.value]
    fields = bank_info.handler.credential_fields(bank_info)
    defaults = {
        "username": BANK_USERNAME,
        "password": BANK_PASSWORD,
        "phone": PHONE_NUMBER,
        "pin": PIN,
    }
    return {field: defaults.get(field, f"{field}-value") for field in fields}  # noqa FKA100


def make_user(
    db_session: Session,
    *,
    user_name: str = USER_NAME,
    display_name: str = DISPLAY_NAME,
    password_hash: str = VALID_PASSWORD_HASH,
    language: str = "en",
) -> User:
    user = User(user_name=user_name, display_name=display_name, password_hash=password_hash, language=language)
    db_session.add(user)
    db_session.flush()
    return user


def make_credential(
    db_session: Session,
    *,
    user_id: int,
    bank: BankProvider = BankProvider.ING,
    credentials: dict[str, str] | None = None,
    requires_two_factor_authentication: bool = False,
    last_fetching_timestamp: datetime | None = None,
) -> Credential:
    user = db_session.get(entity=User, ident=user_id)
    credential = Credential(
        user=user,
        bank=bank,
        credentials=credentials if credentials is not None else _default_credentials_for(bank),
        requires_two_factor_authentication=requires_two_factor_authentication,
        last_fetching_timestamp=last_fetching_timestamp,
    )
    db_session.add(credential)
    db_session.flush()
    return credential


def make_account(
    db_session: Session,
    *,
    credential_id: int,
    name: str = "DE00 1234",
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
    *,
    account_id: int,
    amount: float = -1.0,
    purpose: str | None = None,
    other_party: str | None = None,
    date: _date = _date(year=2026, month=5, day=21),
    transaction_type: TransactionType | None = None,
    category: TransactionCategory = TransactionCategory.UNKNOWN,
    note: str | None = None,
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
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def get_backend_test_path() -> Path:
    return get_root_path_of_repository() / "tests" / "backend"
