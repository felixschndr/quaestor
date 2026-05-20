from source.backend.models.user import User

from tests.backend.conftest import DISPLAY_NAME, USER_NAME


def test_user_repr_contains_identifying_fields_but_not_password():
    user = User(
        id=1, user_name=USER_NAME, display_name=DISPLAY_NAME, password_hash="secret_hash", admin=True
    )  # nosec B106

    representation = repr(user)

    assert representation == f"<User(id=1, user_name={USER_NAME}, display_name={DISPLAY_NAME}, admin=True)>"
    assert "secret_hash" not in representation
