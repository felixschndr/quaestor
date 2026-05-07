import os

from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_ENV_VAR = "FIELD_ENCRYPTION_KEY"
_fernet: Fernet | None = None


def get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.environ.get(_ENV_VAR)
        if not key:
            raise RuntimeError(
                f"{_ENV_VAR} is not set. Generate one with "
                f"`python -m source.crypto` and export it before starting the app."
            )
        _fernet = Fernet(key.encode())
    return _fernet
