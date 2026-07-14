from source.backend.services.auth.password_service import hash_password, verify_password
from tests.backend.conftest import VALID_PASSWORD, WRONG_PASSWORD


def test_verify_password_accepts_the_original_password():
    assert verify_password(password_hash=hash_password(VALID_PASSWORD), password_to_verify=VALID_PASSWORD)


def test_verify_password_rejects_a_different_password():
    assert not verify_password(password_hash=hash_password(VALID_PASSWORD), password_to_verify=WRONG_PASSWORD)


def test_hash_password_returns_a_value_distinct_from_the_input():
    assert hash_password(VALID_PASSWORD) != VALID_PASSWORD


def test_hash_password_uses_a_unique_salt_per_call():
    first_hash = hash_password(VALID_PASSWORD)
    second_hash = hash_password(VALID_PASSWORD)

    assert first_hash != second_hash
    assert verify_password(password_hash=first_hash, password_to_verify=VALID_PASSWORD)
    assert verify_password(password_hash=second_hash, password_to_verify=VALID_PASSWORD)
