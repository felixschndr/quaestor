import re
import secrets
from datetime import timedelta

import pyotp
import segno
from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.exceptions import InvalidTwoFactorError
from source.backend.helpers import get_project_name, hash_token, utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.auth.backup_code import BackupCode
from source.backend.models.auth.two_factor_challenge import TwoFactorChallenge
from source.backend.models.auth.user import User
from source.backend.services.auth.password_service import hash_password, verify_password

logger = get_logger(__name__)

CHALLENGE_DURATION = timedelta(minutes=5)

BACKUP_CODE_COUNT = 5
# Unambiguous alphabet: no 0/O/1/I/L so codes are easy to read off a screen and type back in.
_BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_BACKUP_CODE_GROUPS = 3
_BACKUP_CODE_GROUP_LENGTH = 5
# A TOTP code is six digits; anything else is treated as a backup code at login.
_TOTP_CODE_PATTERN = re.compile(r"^\d{6}$")


def generate_secret() -> str:
    return pyotp.random_base32()


def build_provisioning_uri(secret: str, user_name: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=user_name, issuer_name=get_project_name())


def build_qr_data_uri(provisioning_uri: str) -> str:
    return segno.make(provisioning_uri, error="m").svg_data_uri(scale=5)


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(otp=code.strip(), valid_window=1)


def _normalize_backup_code(code: str) -> str:
    return re.sub(pattern=r"[^A-Z0-9]", repl="", string=code.strip().upper())


def generate_backup_codes() -> list[str]:
    codes = []
    for _ in range(BACKUP_CODE_COUNT):
        groups = [
            "".join(secrets.choice(_BACKUP_CODE_ALPHABET) for _ in range(_BACKUP_CODE_GROUP_LENGTH))
            for _ in range(_BACKUP_CODE_GROUPS)
        ]
        codes.append("-".join(groups))
    return codes


def start_setup(db_session: Session, user: User) -> tuple[str, str, str]:
    if user.two_factor_enabled:
        raise InvalidTwoFactorError("Two-factor authentication is already enabled")
    secret = generate_secret()
    user.two_factor_secret = secret
    user.two_factor_enabled = False
    db_session.commit()
    logger.info(f"Started 2FA setup for {user}")
    provisioning_uri = build_provisioning_uri(secret=secret, user_name=user.user_name)
    return secret, provisioning_uri, build_qr_data_uri(provisioning_uri)


def enable(db_session: Session, user: User, code: str) -> list[str]:
    if not user.two_factor_secret:
        raise InvalidTwoFactorError("Two-factor authentication setup has not been started")
    if not verify_totp(secret=user.two_factor_secret, code=code):
        raise InvalidTwoFactorError("The two-factor code is incorrect")

    user.two_factor_enabled = True
    backup_codes = _issue_backup_codes(user=user)
    db_session.commit()
    logger.info(f"Enabled 2FA for {user}")
    return backup_codes


def regenerate_backup_codes(db_session: Session, user: User) -> list[str]:
    if not user.two_factor_enabled:
        raise InvalidTwoFactorError("Two-factor authentication is not enabled")
    backup_codes = _issue_backup_codes(user=user)
    db_session.commit()
    logger.info(f"Regenerated backup codes for {user}")
    return backup_codes


def _issue_backup_codes(user: User) -> list[str]:
    _replace_backup_codes(user=user)
    backup_codes = generate_backup_codes()
    for backup_code in backup_codes:
        user.backup_codes.append(BackupCode(code_hash=hash_password(_normalize_backup_code(backup_code))))
    return backup_codes


def disable(db_session: Session, user: User, code: str) -> None:
    if not user.two_factor_enabled:
        raise InvalidTwoFactorError("Two-factor authentication is not enabled")
    if not verify_login_code(db_session=db_session, user=user, code=code):
        raise InvalidTwoFactorError("The two-factor code is incorrect")

    user.two_factor_enabled = False
    user.two_factor_secret = None
    _replace_backup_codes(user=user)
    db_session.commit()
    logger.info(f"Disabled 2FA for {user}")


def verify_login_code(db_session: Session, user: User, code: str) -> bool:
    if not user.two_factor_secret:
        return False
    if _TOTP_CODE_PATTERN.match(code.strip()) and verify_totp(secret=user.two_factor_secret, code=code):
        return True
    return _consume_backup_code(db_session=db_session, user=user, code=code)


def _consume_backup_code(db_session: Session, user: User, code: str) -> bool:
    normalized = _normalize_backup_code(code)
    if not normalized:
        return False
    for backup_code in user.backup_codes:
        if verify_password(password_hash=backup_code.code_hash, password_to_verify=normalized):
            user.backup_codes.remove(backup_code)
            db_session.commit()
            logger.info(f"Consumed a backup code for {user}")
            return True
    return False


def _replace_backup_codes(user: User) -> None:
    user.backup_codes.clear()


def create_challenge(db_session: Session, user: User) -> str:
    raw_token = secrets.token_urlsafe(32)
    now = utc_now()
    challenge = TwoFactorChallenge(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        created_at=now,
        expires_at=now + CHALLENGE_DURATION,
    )
    db_session.add(challenge)
    db_session.commit()
    logger.info(f"Created 2FA challenge for {user}")
    return raw_token


def _get_challenge(db_session: Session, raw_token: str) -> TwoFactorChallenge | None:
    challenge = db_session.scalar(
        select(TwoFactorChallenge).where(TwoFactorChallenge.token_hash == hash_token(raw_token))
    )
    if challenge is None:
        return None
    if challenge.expires_at < utc_now():
        logger.debug(f"2FA challenge {challenge.id} expired at {challenge.expires_at:%Y-%m-%d %H:%M:%S}")
        db_session.delete(challenge)
        db_session.commit()
        return None
    return challenge


def resolve_challenge(db_session: Session, raw_token: str) -> User | None:
    challenge = _get_challenge(db_session=db_session, raw_token=raw_token)
    return challenge.user if challenge else None


def delete_challenge(db_session: Session, raw_token: str) -> None:
    challenge = db_session.scalar(
        select(TwoFactorChallenge).where(TwoFactorChallenge.token_hash == hash_token(raw_token))
    )
    if challenge is not None:
        db_session.delete(challenge)
        db_session.commit()
