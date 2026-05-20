from datetime import datetime

from source.backend.models.session import UserSession


def test_user_session_repr_contains_identifying_fields_but_not_token_hash():
    created_at = datetime(year=2026, month=5, day=20, hour=12)
    expires_at = datetime(year=2026, month=6, day=3, hour=12)
    user_session = UserSession(
        id=11,
        user_id=1,
        token_hash="should_not_appear",  # nosec B106
        created_at=created_at,
        expires_at=expires_at,
        remember_me=True,
    )

    representation = repr(user_session)

    assert representation == (
        f"<UserSession(id=11, user_id=1, created_at={created_at}, expires_at={expires_at}, remember_me=True)>"
    )
    assert "should_not_appear" not in representation  # nosec B105
