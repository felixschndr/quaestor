"""End-to-end rotation of FIELD_ENCRYPTION_KEY using the app's SQLAlchemy models.

Usage:
    python scripts/rotate_encryption_key.py            # dry-run, writes nothing
    python scripts/rotate_encryption_key.py --apply    # actually rotate
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import create_engine
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# isort: off
import source.crypto as crypto_mod  # noqa: E402
import source.models  # noqa: E402, F401  -- populates Base.registry
from source.models.base import Base  # noqa: E402
from source.models.types import EncryptedString  # noqa: E402

# isort: on


DB_PATH = ROOT / "bank_app.db"
ENV_PATH = ROOT / ".env"
ENV_VAR = "FIELD_ENCRYPTION_KEY"


# --- .env handling -----------------------------------------------------------


def _read_env_key(env_path: Path) -> tuple[str, list[str], int]:
    """Return (current_value, all_lines, index_of_key_line)."""
    if not env_path.exists():
        sys.exit(f".env not found: {env_path}")
    lines = env_path.read_text().splitlines(keepends=True)
    for idx, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith(f"{ENV_VAR}="):
            value = stripped.split("=", 1)[1].rstrip("\r\n")
            value = value.strip().strip('"').strip("'")
            if not value:
                sys.exit(f"{ENV_VAR} in {env_path} is empty.")
            return value, lines, idx
    sys.exit(f"{ENV_VAR} not found in {env_path}.")


def _write_env_key(env_path: Path, lines: list[str], idx: int, new_value: str) -> None:
    """Atomically replace the FIELD_ENCRYPTION_KEY line."""
    eol = "\r\n" if lines[idx].endswith("\r\n") else "\n"
    lines = list(lines)
    lines[idx] = f"{ENV_VAR}={new_value}{eol}"

    mode = env_path.stat().st_mode & 0o777
    fd, tmp = tempfile.mkstemp(prefix=".env.", dir=str(env_path.parent))
    try:
        with os.fdopen(fd, "w") as fh:
            fh.writelines(lines)
        os.chmod(tmp, mode)
        os.replace(tmp, env_path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


# --- model discovery + rotation ---------------------------------------------


def _discover_targets() -> list[tuple[type, list[str]]]:
    """Return [(mapped_class, [encrypted_attr_names])] for every EncryptedString column."""
    targets: list[tuple[type, list[str]]] = []
    for mapper in Base.registry.mappers:
        cols = [c.key for c in mapper.columns if isinstance(c.type, EncryptedString)]
        if cols:
            targets.append((mapper.class_, cols))
    return targets


def _table_name(cls: type) -> str:
    return sa_inspect(cls).local_table.name


def _rotate(
    session_factory: sessionmaker,
    targets: list[tuple[type, list[str]]],
    old: Fernet,
    new: Fernet,
    *,
    commit: bool,
) -> int:
    """Re-encrypt every row in one transaction, verify, then commit or rollback."""
    total = 0

    # Phase 1: load everything under the OLD key. The EncryptedString type
    # calls crypto_mod.get_fernet() on every read, so we install the OLD
    # Fernet as the cached singleton before any query runs.
    crypto_mod._fernet = old
    with session_factory() as session:
        loaded: list[tuple[type, list[str], list[object]]] = []
        for cls, cols in targets:
            objs = list(session.scalars(select(cls)).all())
            # Touch each encrypted attribute to force decryption *now*, while
            # the OLD key is active. If anything is unreadable we abort
            # before touching anything else.
            for obj in objs:
                for col in cols:
                    try:
                        getattr(obj, col)
                    except InvalidToken:
                        ident = sa_inspect(obj).identity
                        sys.exit(
                            f"{_table_name(cls)}.id={ident} column {col!r} could not be "
                            f"decrypted with the current {ENV_VAR}. Aborting — no rows changed."
                        )
            loaded.append((cls, cols, objs))
            total += len(objs)

        # Phase 2: swap the cached Fernet to the NEW key, mark the encrypted
        # columns dirty (the Python-side plaintext value didn't change, so
        # SQLAlchemy wouldn't otherwise emit an UPDATE), flush. On flush
        # process_bind_param runs and encrypts under the NEW key.
        crypto_mod._fernet = new
        for cls, cols, objs in loaded:
            for obj in objs:
                for col in cols:
                    flag_modified(obj, col)

        session.flush()

        # Phase 3: verify. Expire the identity map so the next access re-reads
        # ciphertext from the (uncommitted) transaction and decrypts under
        # the NEW key. If any row can't be decrypted, rollback.
        session.expire_all()
        for cls, cols in targets:
            for obj in session.scalars(select(cls)).all():
                for col in cols:
                    try:
                        getattr(obj, col)
                    except InvalidToken:
                        ident = sa_inspect(obj).identity
                        session.rollback()
                        sys.exit(
                            f"Verification failed: {_table_name(cls)}.id={ident} column "
                            f"{col!r} does not decrypt under the new key. Rolled back."
                        )

        if commit:
            session.commit()
        else:
            session.rollback()

    return total


# --- main --------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default is dry-run)")
    parser.add_argument("--db", type=Path, default=DB_PATH, help=f"sqlite path (default: {DB_PATH})")
    parser.add_argument("--env", type=Path, default=ENV_PATH, help=f".env path (default: {ENV_PATH})")
    args = parser.parse_args()

    if not args.db.exists():
        sys.exit(f"DB not found: {args.db}")

    old_value, env_lines, env_idx = _read_env_key(args.env)
    try:
        old_fernet = Fernet(old_value.encode())
    except ValueError as exc:
        sys.exit(f"Current {ENV_VAR} is not a valid Fernet key: {exc}")

    new_value = Fernet.generate_key().decode()
    new_fernet = Fernet(new_value.encode())

    targets = _discover_targets()
    if not targets:
        sys.exit("No EncryptedString columns found in Base.registry — nothing to rotate.")

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] rotating {ENV_VAR}")
    print(f"  db:  {args.db}")
    print(f"  env: {args.env}")
    for cls, cols in targets:
        print(f"  target: {_table_name(cls)} ({', '.join(cols)})")

    engine = create_engine(f"sqlite:///{args.db}")
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

    try:
        total = _rotate(SessionLocal, targets, old_fernet, new_fernet, commit=args.apply)
    finally:
        engine.dispose()

    print(f"  {total} rows re-encrypted")

    if not args.apply:
        print("dry-run ok. re-run with --apply.")
        return

    _write_env_key(args.env, env_lines, env_idx, new_value)
    print(f"Done, .env updated: {ENV_VAR} now points at the new key")


if __name__ == "__main__":
    main()
