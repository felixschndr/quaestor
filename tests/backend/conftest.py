import pytest
from fastapi.testclient import TestClient
from httpx import Response
from source.backend import main
from source.backend.db import get_session
from source.backend.models.base import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

VALID_PASSWORD = "Sup3rSecret!Pass"  # nosec: B105


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


def register(http_client: TestClient, name: str = "alice", password: str = VALID_PASSWORD) -> Response:
    return http_client.post("/register", json={"name": name, "password": password})


def login_as(http_client: TestClient, name: str, password: str = VALID_PASSWORD) -> Response:
    http_client.cookies.clear()
    return http_client.post("/login", json={"name": name, "password": password})


def create_credential(
    http_client: TestClient, bank: str = "ing", credentials: dict[str, str] | None = None
) -> Response:
    if credentials is None:
        credentials = {"username": "bankuser", "password": "bankpass"}  # nosec: B105
    return http_client.post("/credentials", json={"bank": bank, "credentials": credentials})
