from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from source.backend import csrf, main, rate_limit
from source.backend.db import get_session
from source.backend.models.base import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

USER_NAME = "alice"
DISPLAY_NAME = "Alice"
VALID_PASSWORD = "Sup3rSecret!Pass"  # nosec B105
VALID_PASSWORD_HASH = "Sup3rSecret!Pass2"  # nosec B105
NEW_VALID_PASSWORD = "BrandNewPa55word!"  # nosec B105
WRONG_PASSWORD = "Wr0ngPassword!!"  # nosec B105
BANK_USERNAME = "bankuser"
BANK_PASSWORD = "bankpass"  # nosec B105
UNKNOWN_TRANSACTION_OTHER_PARTY = "Some random other party"


@pytest.fixture(autouse=True)
def disable_background_tasks(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=AsyncMock())
    monkeypatch.setattr(target=main.category_rescan, name="run_startup_rescan", value=AsyncMock())


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
