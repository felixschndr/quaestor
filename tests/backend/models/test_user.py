from source.backend.models.user import User


def test_user_repr_contains_identifying_fields_but_not_password():
    user = User(id=1, user_name="alice", display_name="Alice", password_hash="secret_hash", admin=True)  # nosec B106

    representation = repr(user)

    assert representation == "<User(id=1, user_name=alice, display_name=Alice, admin=True)>"
    assert "secret_hash" not in representation
