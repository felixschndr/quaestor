"""
Copy the production database to the local data dir, wipe all stored bank
credentials, then rotate the encryption key.

Usage:
    python scripts/copy_prod_db_to_local.py
"""

from __future__ import annotations

import os
import subprocess  # nosec B404
import sys
from pathlib import Path

import sqlcipher3

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import rotate_db_encryption_key  # noqa: E402
from source.backend.db import KEY_ENV_VARIABLE_NAME  # noqa: E402
from source.backend.paths import DATABASE_PATH, ENV_FILE_PATH  # noqa: E402

REMOTE_HOST = "grievous.fs"
REMOTE_DB = "server/Quaestor/data/quaestor/Quaestor.db"
REMOTE_ENV = "server/Quaestor/.env"


def _copy_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    command = ["/usr/bin/scp", f"{REMOTE_HOST}:{REMOTE_DB}", str(DATABASE_PATH)]
    print(f"Running: {' '.join(command)}")
    subprocess.run(command, check=True)  # nosec B603


def _get_remote_encryption_key() -> str:
    out = subprocess.run(
        ["/usr/bin/ssh", REMOTE_HOST, f"cat {REMOTE_ENV}"], check=True, capture_output=True, text=True
    ).stdout  # nosec B603
    for line in out.splitlines():
        if line.lstrip().startswith(f"{KEY_ENV_VARIABLE_NAME}="):
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{KEY_ENV_VARIABLE_NAME} not found in {REMOTE_ENV} on {REMOTE_HOST}.")


def _wipe_credentials(db_path: Path, key: str) -> None:
    conn = sqlcipher3.connect(str(db_path))
    try:
        conn.execute(f"PRAGMA key = '{key.replace(chr(39), chr(39) * 2)}'")
        cleared = conn.execute("UPDATE credentials SET credentials = '{}'").rowcount
        conn.commit()
        print(f"  cleared credentials column on {cleared} row(s)")
    finally:
        conn.close()


def main() -> None:
    _copy_database()

    prod_key = _get_remote_encryption_key()

    print("Wiping credentials")
    _wipe_credentials(DATABASE_PATH, prod_key)

    rotate_db_encryption_key._write_env_key(ENV_FILE_PATH, prod_key)
    os.environ[KEY_ENV_VARIABLE_NAME] = prod_key

    print("Rotating encryption key")
    sys.argv = ["rotate_db_encryption_key.py", "--apply"]
    rotate_db_encryption_key.main()


if __name__ == "__main__":
    main()
