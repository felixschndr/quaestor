import os
from collections.abc import Iterator
from pathlib import Path

import sqlcipher3
from dotenv import load_dotenv
from source.backend.logging_utils import get_logger
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

KEY_ENV_VARIABLE_NAME = "DATABASE_ENCRYPTION_KEY"
ROOT = Path(__file__).resolve().parent.parent.parent
ENV_FILE_PATH = ROOT / ".env"
DB_PATH = ROOT / "bank_app.db"

load_dotenv(dotenv_path=ENV_FILE_PATH)
logger = get_logger(__name__)


def _database_key() -> str:
    key = os.environ.get(KEY_ENV_VARIABLE_NAME)
    if not key:
        raise RuntimeError(
            f"{KEY_ENV_VARIABLE_NAME} is not set. Generate one with "
            f"`python -c 'import secrets; print(secrets.token_hex(32))'` "
            f"and export it before starting the app."
        )
    return key


# Plain sqlite dialect, but driven by the SQLCipher DBAPI, so the whole database file is AES-encrypted at rest
engine = create_engine(f"sqlite:///{DB_PATH}", module=sqlcipher3.dbapi2)


def log_database_location() -> None:
    # Called from the app lifespan so it runs after logging is configured
    logger.info(f"Using database at {DB_PATH}")


@event.listens_for(target=engine, identifier="connect")
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
    with SessionLocal() as db_session:
        yield db_session
