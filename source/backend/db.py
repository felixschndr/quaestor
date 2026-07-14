import os
from collections.abc import Iterator
from pathlib import Path

import sqlcipher3
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from source.backend.logging_utils import get_logger
from source.backend.paths import DATABASE_PATH

KEY_ENV_VARIABLE_NAME = "DATABASE_ENCRYPTION_KEY"

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
    mount_point = _nearest_mount_point(DATABASE_PATH.parent)
    if mount_point == Path("/"):
        logger.warning(
            f"No volume or bind mount was detected for the database. "
            f"All data will be lost when the container is removed or replaced. Mount a volume covering {DATABASE_PATH}."
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
engine = create_engine(f"sqlite:///{DATABASE_PATH}", module=sqlcipher3.dbapi2)


def log_database_location() -> None:
    # Called from the app lifespan so it runs after logging is configured
    logger.info(f"Using database at {DATABASE_PATH}")
    if not DATABASE_PATH.exists():
        logger.info(f"No existing database found at {DATABASE_PATH} --> a new one will be created.")
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
