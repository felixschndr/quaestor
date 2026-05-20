from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password_to_verify: str) -> bool:
    try:
        _password_hasher.verify(hash=password_hash, password=password_to_verify)
    except VerifyMismatchError:
        logger.debug("Password verification failed: mismatch")
        return False
    logger.debug("Password verification succeeded")
    return True
