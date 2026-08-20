"""
Copy the production database to the local data dir, then rotate the encryption key.

By default, the login credentials are wiped from the copy. Pass --keep-credentials to leave them in place.

Usage:
    python scripts/db/copy_prod_db_to_local.py
    python scripts/db/copy_prod_db_to_local.py --keep-credentials
"""

from __future__ import annotations

import argparse
import os
import subprocess  # nosec B404
import sys
from pathlib import Path

import sqlcipher3

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scripts.db import rotate_db_encryption_key
from source.backend.db import KEY_ENV_VARIABLE_NAME
from source.backend.paths import DATABASE_PATH, ENV_FILE_PATH

REMOTE_HOST = "grievous.fs"
REMOTE_DB = "server/Quaestor/data/quaestor/Quaestor.db"
REMOTE_ENV = "server/Quaestor/.env"


def _copy_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("-wal", "-shm"):
        DATABASE_PATH.with_name(DATABASE_PATH.name + suffix).unlink(missing_ok=True)
    dest = DATABASE_PATH.parent
    subprocess.run(["/usr/bin/scp", f"{REMOTE_HOST}:{REMOTE_DB}", str(DATABASE_PATH)], check=True)  # nosec B603
    for suffix in ("-wal", "-shm"):
        subprocess.run(["/usr/bin/scp", f"{REMOTE_HOST}:{REMOTE_DB}{suffix}", str(dest)], check=False)  # nosec B603


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
        conn.execute(f"PRAGMA key = '{rotate_db_encryption_key._escape(key)}'")
        conn.execute("UPDATE credentials SET credentials = '{}', session_state = NULL")
        conn.commit()
    finally:
        conn.close()
    print("Wiped login credentials")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-credentials", action="store_true", help="keep the login secrets instead of wiping them")
    args = parser.parse_args()

    _copy_database()

    prod_key = _get_remote_encryption_key()

    if not args.keep_credentials:
        _wipe_credentials(DATABASE_PATH, prod_key)

    rotate_db_encryption_key._write_env_key(ENV_FILE_PATH, prod_key)
    os.environ[KEY_ENV_VARIABLE_NAME] = prod_key

    print("Rotating encryption key")
    sys.argv = ["rotate_db_encryption_key.py", "--apply"]
    rotate_db_encryption_key.main()


if __name__ == "__main__":
    main()
