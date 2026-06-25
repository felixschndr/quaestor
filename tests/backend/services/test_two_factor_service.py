import re
from datetime import timedelta

import pyotp
import pytest
from source.backend.exceptions import InvalidTwoFactorError
from source.backend.helpers import utc_now
from source.backend.models.two_factor_challenge import TwoFactorChallenge
from source.backend.models.user import User
from source.backend.services import two_factor_service
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import USER_NAME, assert_log_contains, create_user

_BACKUP_CODE_FORMAT = re.compile(r"^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$")


def test_generate_backup_codes_have_expected_format_and_count():
    codes = two_factor_service.generate_backup_codes()

    assert len(codes) == two_factor_service.BACKUP_CODE_COUNT
    assert len(set(codes)) == two_factor_service.BACKUP_CODE_COUNT  # no duplicates
    assert all(_BACKUP_CODE_FORMAT.match(code) for code in codes)


def test_provisioning_uri_and_qr_embed_issuer():
    secret = two_factor_service.generate_secret()

    uri = two_factor_service.build_provisioning_uri(secret=secret, user_name=USER_NAME)

    assert "issuer=Quaestor" in uri
    assert two_factor_service.build_qr_data_uri(uri).startswith("data:image/svg+xml")


def test_verify_totp_accepts_current_code_and_rejects_wrong_one():
    secret = two_factor_service.generate_secret()

    assert two_factor_service.verify_totp(secret=secret, code=pyotp.TOTP(secret).now()) is True
    assert two_factor_service.verify_totp(secret=secret, code="000000") is False


def test_enable_requires_setup_first(session_factory: sessionmaker):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        with pytest.raises(InvalidTwoFactorError):
            two_factor_service.enable(db_session=db_session, user=attached, code="000000")


def test_setup_then_enable_turns_on_2fa_and_returns_backup_codes(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        secret, _, _ = two_factor_service.start_setup(db_session=db_session, user=attached)
        codes = two_factor_service.enable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        assert_log_contains(caplog, messages=["Started 2FA setup for", "Enabled 2FA for"])
        assert attached.two_factor_enabled is True
        assert len(codes) == two_factor_service.BACKUP_CODE_COUNT
        assert len(attached.backup_codes) == two_factor_service.BACKUP_CODE_COUNT


def test_setup_is_rejected_while_already_enabled(session_factory: sessionmaker):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        secret, _, _ = two_factor_service.start_setup(db_session=db_session, user=attached)
        two_factor_service.enable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        with pytest.raises(InvalidTwoFactorError):
            two_factor_service.start_setup(db_session=db_session, user=attached)


def test_backup_code_logs_in_once_then_is_consumed(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        secret, _, _ = two_factor_service.start_setup(db_session=db_session, user=attached)
        codes = two_factor_service.enable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        assert two_factor_service.verify_login_code(db_session=db_session, user=attached, code=codes[0]) is True
        assert_log_contains(caplog, message="Consumed a backup code for")
        # Single use: the same code must not work a second time.
        assert two_factor_service.verify_login_code(db_session=db_session, user=attached, code=codes[0]) is False
        # A lowercase, space-separated variant of another code still matches (normalization).
        messy = codes[1].lower().replace("-", " ")
        assert two_factor_service.verify_login_code(db_session=db_session, user=attached, code=messy) is True


def test_disable_clears_secret_and_backup_codes(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        secret, _, _ = two_factor_service.start_setup(db_session=db_session, user=attached)
        two_factor_service.enable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        two_factor_service.disable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        assert_log_contains(caplog, message="Disabled 2FA for")
        assert attached.two_factor_enabled is False
        assert attached.two_factor_secret is None
        assert attached.backup_codes == []


def test_disable_rejects_wrong_code(session_factory: sessionmaker):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        secret, _, _ = two_factor_service.start_setup(db_session=db_session, user=attached)
        two_factor_service.enable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        with pytest.raises(InvalidTwoFactorError):
            two_factor_service.disable(db_session=db_session, user=attached, code="000000")
        assert attached.two_factor_enabled is True


def test_regenerate_backup_codes_replaces_and_invalidates_old(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        secret, _, _ = two_factor_service.start_setup(db_session=db_session, user=attached)
        old_codes = two_factor_service.enable(db_session=db_session, user=attached, code=pyotp.TOTP(secret).now())

        new_codes = two_factor_service.regenerate_backup_codes(db_session=db_session, user=attached)

        assert_log_contains(caplog, message="Regenerated backup codes for")
        assert len(new_codes) == two_factor_service.BACKUP_CODE_COUNT
        assert set(new_codes).isdisjoint(old_codes)
        assert two_factor_service.verify_login_code(db_session=db_session, user=attached, code=old_codes[0]) is False
        assert two_factor_service.verify_login_code(db_session=db_session, user=attached, code=new_codes[0]) is True


def test_regenerate_backup_codes_requires_enabled(session_factory: sessionmaker):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        with pytest.raises(InvalidTwoFactorError):
            two_factor_service.regenerate_backup_codes(db_session=db_session, user=attached)


def test_challenge_resolves_until_expired(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    user = create_user(session_factory=session_factory)
    with session_factory() as db_session:
        attached = db_session.get(entity=User, ident=user.id)
        raw_token = two_factor_service.create_challenge(db_session=db_session, user=attached)
        assert_log_contains(caplog, message="Created 2FA challenge for")

        resolved = two_factor_service.resolve_challenge(db_session=db_session, raw_token=raw_token)
        assert resolved is not None and resolved.id == user.id

        challenge = db_session.scalar(select(TwoFactorChallenge))
        challenge.expires_at = utc_now() - timedelta(seconds=1)
        db_session.commit()

        assert two_factor_service.resolve_challenge(db_session=db_session, raw_token=raw_token) is None


def test_resolve_challenge_returns_none_for_unknown_token(session_factory: sessionmaker):
    with session_factory() as db_session:
        assert two_factor_service.resolve_challenge(db_session=db_session, raw_token="nope") is None  # nosec B106
