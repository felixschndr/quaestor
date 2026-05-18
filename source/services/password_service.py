import logging

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

logger = logging.getLogger(__name__)

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password_to_verify: str) -> bool:
    try:
        _password_hasher.verify(hash=password_hash, password=password_to_verify)
    except VerifyMismatchError:
        return False
    return True
