from datetime import datetime

from source.backend.models.auth.api_key import ApiKey


def test_api_key_repr_contains_identifying_fields_but_not_token_hash():
    created_at = datetime(year=2026, month=5, day=20, hour=12)
    last_used_at = datetime(year=2026, month=5, day=21, hour=8)
    api_key = ApiKey(
        id=7,
        user_id=1,
        name="My script",
        token_hash="should_not_appear",  # nosec B106
        prefix="qk_abcdef",
        created_at=created_at,
        last_used_at=last_used_at,
    )

    representation = repr(api_key)

    assert representation == (
        f"<ApiKey(id=7, user_id=1, name=My script, prefix=qk_abcdef, "
        f"created_at={created_at}, last_used_at={last_used_at})>"
    )
    assert "should_not_appear" not in representation
