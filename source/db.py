import os
from collections.abc import Iterator

import sqlcipher3
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

KEY_ENV_VARIABLE_NAME = "DATABASE_ENCRYPTION_KEY"


def _database_key() -> str:
    key = os.environ.get(KEY_ENV_VARIABLE_NAME)
    if not key:
        raise RuntimeError(
            f"{KEY_ENV_VARIABLE_NAME} is not set. Generate one with "
            f"`python -c 'import secrets; print(secrets.token_hex(32))'` "
            f"and export it before starting the app."
        )
    return key


# Plain sqlite dialect, but driven by the SQLCipher DBAPI so the whole database file is AES-encrypted at rest
engine = create_engine("sqlite:///bank_app.db", module=sqlcipher3.dbapi2)


@event.listens_for(engine, "connect")
def _configure_sqlcipher(dbapi_connection: object, _connection_record: object) -> None:
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        # PRAGMA key must be the first statement on every new connection
        escaped = _database_key().replace("'", "''")
        cursor.execute(f"PRAGMA key = '{escaped}'")
        # Keep temp files in memory so nothing lands on disk in plaintext
        cursor.execute("PRAGMA temp_store = MEMORY")
    finally:
        cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
