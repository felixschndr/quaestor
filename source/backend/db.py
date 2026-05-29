import os
from collections.abc import Iterator
from pathlib import Path

import sqlcipher3
from dotenv import load_dotenv
from source.backend.helpers import get_root_path_of_repository
from source.backend.logging_utils import get_logger
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

KEY_ENV_VARIABLE_NAME = "DATABASE_ENCRYPTION_KEY"
ROOT = get_root_path_of_repository()
ENV_FILE_PATH = ROOT / ".env"
DB_PATH = ROOT / "bank_app.db"

load_dotenv(dotenv_path=ENV_FILE_PATH)
logger = get_logger(__name__)


def _running_in_container() -> bool:
    return Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()


def _nearest_mount_point(path: Path) -> Path:
    p = path.resolve()
    while p != p.parent:
        if os.path.ismount(p):
            return p
        p = p.parent
    return p


def _warn_if_db_not_on_volume() -> None:
    if not _running_in_container():
        return
    mount_point = _nearest_mount_point(DB_PATH.parent)
    if mount_point == Path("/"):
        logger.warning(
            f"No volume or bind mount was detected for the database. "
            f"All data will be lost when the container is removed or replaced. Mount a volume covering {DB_PATH}."
        )


def _database_key() -> str:
    key = os.environ.get(KEY_ENV_VARIABLE_NAME)
    if not key:
        raise RuntimeError(
            f"{KEY_ENV_VARIABLE_NAME} is not set. Generate one with "
            "`python -c 'import secrets; print(secrets.token_hex(32))'` "
            "and set in in env (export/container env) before starting the app."
        )
    return key


# Plain sqlite dialect, but driven by the SQLCipher DBAPI, so the whole database file is AES-encrypted at rest
engine = create_engine(f"sqlite:///{DB_PATH}", module=sqlcipher3.dbapi2)


def log_database_location() -> None:
    # Called from the app lifespan so it runs after logging is configured
    logger.info(f"Using database at {DB_PATH}")
    if not DB_PATH.exists():
        logger.info(f"No existing database found at {DB_PATH} --> a new one will be created.")
    _warn_if_db_not_on_volume()


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


def close_engine() -> None:
    logger.info("Closing the database")
    engine.dispose()
