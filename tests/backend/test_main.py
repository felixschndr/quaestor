import pytest
from fastapi.testclient import TestClient
from source.backend import main
from source.backend.bank_handlers import FinTSHandler
from source.backend.models.application_secret import ApplicationSecret
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

SECRET_NAME = FinTSHandler.PRODUCT_ID_SECRET_NAME


def test_app_startup_creates_db_objects_when_missing(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)

    with session_factory() as session:
        assert session.scalars(select(ApplicationSecret)).all() == []

    with TestClient(main.app):
        pass  # entering the context runs the lifespan (--> the app startup)

    with session_factory() as session:
        secret = session.scalar(select(ApplicationSecret).where(ApplicationSecret.name == SECRET_NAME))

    assert secret is not None and secret.value == ""


def test_app_restart_does_not_duplicate_or_overwrite_db_existing_entries(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)

    with TestClient(main.app):
        pass  # first start creates the entries

    with session_factory() as session:
        session.scalar(select(ApplicationSecret).where(ApplicationSecret.name == SECRET_NAME)).value = "custom"
        session.commit()

    with TestClient(main.app):
        pass  # second start must be a no-op for already existing entries

    with session_factory() as session:
        secrets = session.scalars(select(ApplicationSecret)).all()

    assert len(secrets) == 1
    assert secrets[0].value == "custom"
