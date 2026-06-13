"""
Script to rotate the encryption key (in case it gets leaked).

Usage:
    Dry run:         python scripts/rotate_db_encryption_key.py
    Actually rotate: python scripts/rotate_db_encryption_key.py --apply
"""

from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

import sqlcipher3
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from source.backend.db import KEY_ENV_VARIABLE_NAME  # noqa: E402
from source.backend.paths import DATABASE_PATH, ENV_FILE_PATH  # noqa: E402


def _write_env_key(env_path: Path, new_value: str) -> None:
    lines = env_path.read_text().splitlines(keepends=True)
    for idx, line in enumerate(lines):
        if line.lstrip().startswith(f"{KEY_ENV_VARIABLE_NAME}="):
            eol = "\r\n" if line.endswith("\r\n") else "\n"
            lines[idx] = f"{KEY_ENV_VARIABLE_NAME}={new_value}{eol}"
            env_path.write_text("".join(lines))
            return
    sys.exit(f"{KEY_ENV_VARIABLE_NAME} not found in {env_path}.")


def _escape(key: str) -> str:
    return key.replace("'", "''")


def _assert_current_key_opens_db(db_path: Path, key: str) -> None:
    conn = sqlcipher3.connect(str(db_path))
    try:
        conn.execute(f"PRAGMA key = '{_escape(key)}'")
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlcipher3.DatabaseError as exc:
        sys.exit(
            f"Database does not decrypt with the current {KEY_ENV_VARIABLE_NAME}: {exc}. Aborting — nothing changed."
        )
    finally:
        conn.close()


def _set_new_key(db_path: Path, old_key: str, new_key: str) -> None:
    conn = sqlcipher3.connect(str(db_path))
    try:
        conn.execute(f"PRAGMA key = '{_escape(old_key)}'")
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()  # verify old key
        conn.execute(f"PRAGMA rekey = '{_escape(new_key)}'")
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default is dry-run)")
    parser.add_argument("--db", type=Path, default=DATABASE_PATH, help=f"sqlite path (default: {DATABASE_PATH})")
    parser.add_argument("--env", type=Path, default=ENV_FILE_PATH, help=f".env path (default: {ENV_FILE_PATH})")
    args = parser.parse_args()

    if not args.db.exists():
        sys.exit(f"DB not found: {args.db}")

    if not args.env.exists():
        sys.exit(f".env not found: {args.env}")

    load_dotenv(args.env)
    old_key = os.environ.get(KEY_ENV_VARIABLE_NAME)
    if not old_key:
        sys.exit(f"{KEY_ENV_VARIABLE_NAME} is not set (checked environment and {args.env}).")

    new_key = secrets.token_hex(32)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] rotating {KEY_ENV_VARIABLE_NAME}")
    print(f"  db:  {args.db}")
    print(f"  env: {args.env}")

    _assert_current_key_opens_db(args.db, old_key)
    print("  current key OK (database decrypts)")

    if not args.apply:
        print("dry-run ok. re-run with --apply to rekey and update .env.")
        return

    _set_new_key(args.db, old_key, new_key)
    _assert_current_key_opens_db(args.db, new_key)  # confirm the new key works before touching .env
    _write_env_key(args.env, new_key)
    print(f"Done: database re-encrypted, .env updated ({KEY_ENV_VARIABLE_NAME} now points at the new key)")


if __name__ == "__main__":
    main()
