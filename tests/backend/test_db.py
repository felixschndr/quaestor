from pathlib import Path
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from source.backend import db
from tests.backend.conftest import assert_log_contains


@pytest.mark.parametrize(argnames="env_value", argvalues=[None, ""])
def test_database_key_requires_non_empty_env_var(env_value: str | None, monkeypatch: pytest.MonkeyPatch):
    if env_value is None:
        monkeypatch.delenv(name=db.KEY_ENV_VARIABLE_NAME, raising=False)
    else:
        monkeypatch.setenv(name=db.KEY_ENV_VARIABLE_NAME, value=env_value)

    with pytest.raises(RuntimeError, match=db.KEY_ENV_VARIABLE_NAME):
        db._database_key()


def test_configure_sqlcipher_sets_pragma_key_and_temp_store(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=db.KEY_ENV_VARIABLE_NAME, value="abc'def")  # apostrophe forces escaping
    cursor = MagicMock()
    connection = MagicMock()
    connection.cursor.return_value = cursor

    db._configure_sqlcipher(dbapi_connection=connection, _connection_record=None)

    executed_statements = [call.args[0] for call in cursor.execute.call_args_list]
    assert executed_statements[0] == "PRAGMA key = 'abc''def'"
    assert "PRAGMA temp_store = MEMORY" in executed_statements
    cursor.close.assert_called_once()


def test_configure_sqlcipher_closes_cursor_even_if_pragma_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name=db.KEY_ENV_VARIABLE_NAME, value="any")
    cursor = MagicMock()
    cursor.execute.side_effect = RuntimeError("pragma failed")
    connection = MagicMock()
    connection.cursor.return_value = cursor

    with pytest.raises(RuntimeError, match="pragma failed"):
        db._configure_sqlcipher(dbapi_connection=connection, _connection_record=None)

    cursor.close.assert_called_once()


def test_get_session_yields_a_session(monkeypatch: pytest.MonkeyPatch):
    fake_factory = MagicMock()
    monkeypatch.setattr(target=db, name="SessionLocal", value=fake_factory)

    generator = db.get_session()
    yielded = next(generator)

    assert yielded is fake_factory.return_value.__enter__.return_value
    with pytest.raises(StopIteration):
        next(generator)


def test_get_session_returns_real_session_instances():
    engine = create_engine("sqlite://")
    factory = sessionmaker(bind=engine)

    try:
        with factory() as session:
            assert isinstance(session, Session)
    finally:
        engine.dispose()


def test_log_database_location_announces_a_missing_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=db, name="DATABASE_PATH", value=tmp_path / "does-not-exist.db")
    monkeypatch.setattr(target=db, name="_running_in_container", value=lambda: False)

    db.log_database_location()

    assert_log_contains(caplog, messages=["Using database at", "No existing database found at"])


def test_log_database_location_stays_quiet_about_a_missing_database_when_it_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    database_path = tmp_path / "quaestor.db"
    database_path.touch()
    monkeypatch.setattr(target=db, name="DATABASE_PATH", value=database_path)
    monkeypatch.setattr(target=db, name="_running_in_container", value=lambda: False)

    db.log_database_location()

    assert_log_contains(caplog, message="Using database at")
    assert_log_contains(caplog, message="No existing database found at", negate=True)


def test_log_database_location_warns_when_the_database_is_not_on_a_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=db, name="DATABASE_PATH", value=tmp_path / "quaestor.db")
    monkeypatch.setattr(target=db, name="_running_in_container", value=lambda: True)
    monkeypatch.setattr(target=db.os.path, name="ismount", value=lambda path: False)

    db.log_database_location()

    assert_log_contains(caplog, message="No volume or bind mount was detected for the database")


def test_log_database_location_does_not_warn_outside_a_container(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=db, name="DATABASE_PATH", value=tmp_path / "quaestor.db")
    monkeypatch.setattr(target=db, name="_running_in_container", value=lambda: False)

    db.log_database_location()

    assert_log_contains(caplog, message="No volume or bind mount", negate=True)


def test_close_engine_disposes_and_logs(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    engine = MagicMock()
    monkeypatch.setattr(target=db, name="engine", value=engine)

    db.close_engine()

    engine.dispose.assert_called_once_with()
    assert_log_contains(caplog, message="Closing the database")
