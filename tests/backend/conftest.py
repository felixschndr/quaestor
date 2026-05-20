from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from source.backend import main
from source.backend.db import get_session
from source.backend.models.base import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

USER_NAME = "alice"
DISPLAY_NAME = "Alice"
VALID_PASSWORD = "Sup3rSecret!Pass"  # nosec B105
WRONG_PASSWORD = "Wr0ngPassword!!"  # nosec B105
BANK_USERNAME = "bankuser"
BANK_PASSWORD = "bankpass"  # nosec B105


@pytest.fixture(autouse=True)
def disable_periodic_sync(monkeypatch: pytest.MonkeyPatch):
    # Remove periodic sync for testing
    monkeypatch.setattr(target=main.sync_scheduler, name="run_periodic_sync", value=AsyncMock())


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
        yield test_client
    main.app.dependency_overrides.clear()


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
    http_client.cookies.clear()
    return http_client.post("/api/auth/login", json={"user_name": user_name, "password": password})


def create_credential(
    http_client: TestClient, bank: str = "ing", credentials: dict[str, str] | None = None
) -> Response:
    if credentials is None:
        credentials = {"username": BANK_USERNAME, "password": BANK_PASSWORD}
    return http_client.post("/api/credentials", json={"bank": bank, "credentials": credentials})
