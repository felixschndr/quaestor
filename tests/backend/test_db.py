from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from source.backend import db


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
