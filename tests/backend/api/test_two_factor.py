from fastapi.testclient import TestClient

from tests.backend.conftest import (
    SECOND_USER_NAME,
    USER_NAME,
    VALID_PASSWORD,
    current_totp,
    enable_two_factor,
    register_and_get_id,
    register_and_login,
)


def test_setup_returns_secret_and_qr(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    response = http_client.post(f"/api/users/{user_id}/2fa/setup")

    assert response.status_code == 200
    body = response.json()
    assert body["secret"]
    assert "issuer=Quaestor" in body["otpauth_uri"]
    assert body["qr_code"].startswith("data:image/svg+xml")
    # 2FA is disabled until setup is done
    assert http_client.get("/api/auth/me").json()["two_factor_enabled"] is False


def test_enable_with_valid_code_returns_backup_codes_and_flags_user(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    secret = http_client.post(f"/api/users/{user_id}/2fa/setup").json()["secret"]

    response = http_client.post(f"/api/users/{user_id}/2fa/enable", json={"code": current_totp(secret)})

    assert response.status_code == 200
    assert len(response.json()["backup_codes"]) == 5
    assert http_client.get("/api/auth/me").json()["two_factor_enabled"] is True


def test_enable_revokes_all_other_sessions(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    totp_secret = http_client.post(f"/api/users/{user_id}/2fa/setup").json()["secret"]
    # A second login leaves a stale session behind in the DB; the client now holds the newest one.
    http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})
    assert len(http_client.get(f"/api/users/{user_id}/sessions").json()) == 2

    response = http_client.post(f"/api/users/{user_id}/2fa/enable", json={"code": current_totp(totp_secret)})

    assert response.status_code == 200
    remaining = http_client.get(f"/api/users/{user_id}/sessions").json()
    assert len(remaining) == 1
    assert remaining[0]["is_current"] is True


def test_enable_with_wrong_code_is_rejected(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    http_client.post(f"/api/users/{user_id}/2fa/setup")

    response = http_client.post(f"/api/users/{user_id}/2fa/enable", json={"code": "000000"})

    assert response.status_code == 422
    assert http_client.get("/api/auth/me").json()["two_factor_enabled"] is False


def test_login_with_2fa_returns_challenge_instead_of_session(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    enable_two_factor(http_client, user_id=user_id)
    http_client.cookies.delete("session")

    response = http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["two_factor_required"] is True
    assert body["challenge_token"]
    assert "set-cookie" not in response.headers


def test_full_2fa_login_with_totp(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    secret, _ = enable_two_factor(http_client, user_id=user_id)
    http_client.cookies.delete("session")

    challenge_token = http_client.post(
        "/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD}
    ).json()["challenge_token"]
    response = http_client.post(
        "/api/auth/2fa", json={"challenge_token": challenge_token, "code": current_totp(secret)}
    )

    assert response.status_code == 200
    assert response.json()["user_name"] == USER_NAME
    assert http_client.get("/api/auth/me").status_code == 200


def test_2fa_login_with_backup_code_is_single_use(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    _, backup_codes = enable_two_factor(http_client, user_id=user_id)
    http_client.cookies.delete("session")

    def login_and_submit(code: str):
        token = http_client.post("/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD}).json()[
            "challenge_token"
        ]
        return http_client.post("/api/auth/2fa", json={"challenge_token": token, "code": code})

    assert login_and_submit(backup_codes[0]).status_code == 200
    http_client.cookies.delete("session")
    assert login_and_submit(backup_codes[0]).status_code == 401


def test_2fa_login_with_wrong_code_keeps_challenge_for_retry(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    secret, _ = enable_two_factor(http_client, user_id=user_id)
    http_client.cookies.delete("session")

    challenge_token = http_client.post(
        "/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD}
    ).json()["challenge_token"]

    wrong = http_client.post("/api/auth/2fa", json={"challenge_token": challenge_token, "code": "000000"})
    assert wrong.status_code == 401

    retry = http_client.post("/api/auth/2fa", json={"challenge_token": challenge_token, "code": current_totp(secret)})
    assert retry.status_code == 200


def test_2fa_login_with_unknown_challenge_is_unauthorized(http_client: TestClient):
    response = http_client.post("/api/auth/2fa", json={"challenge_token": "nope", "code": "000000"})  # nosec B105

    assert response.status_code == 401


def test_disable_requires_valid_code(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    secret, backup_codes = enable_two_factor(http_client, user_id=user_id)

    assert http_client.post(f"/api/users/{user_id}/2fa/disable", json={"code": "000000"}).status_code == 422
    assert http_client.get("/api/auth/me").json()["two_factor_enabled"] is True

    response = http_client.post(f"/api/users/{user_id}/2fa/disable", json={"code": current_totp(secret)})
    assert response.status_code == 204
    assert http_client.get("/api/auth/me").json()["two_factor_enabled"] is False


def test_regenerate_backup_codes_invalidates_the_old_set(http_client: TestClient):
    user_id = register_and_get_id(http_client)
    _, old_codes = enable_two_factor(http_client, user_id=user_id)

    response = http_client.post(f"/api/users/{user_id}/2fa/backup-codes")
    assert response.status_code == 200
    new_codes = response.json()["backup_codes"]
    assert len(new_codes) == 5
    assert set(new_codes).isdisjoint(old_codes)

    http_client.cookies.delete("session")
    challenge_token = http_client.post(
        "/api/auth/login", json={"user_name": USER_NAME, "password": VALID_PASSWORD}
    ).json()["challenge_token"]
    assert (
        http_client.post("/api/auth/2fa", json={"challenge_token": challenge_token, "code": old_codes[0]}).status_code
        == 401
    )
    assert (
        http_client.post("/api/auth/2fa", json={"challenge_token": challenge_token, "code": new_codes[0]}).status_code
        == 200
    )


def test_regenerate_backup_codes_requires_2fa_enabled(http_client: TestClient):
    user_id = register_and_get_id(http_client)

    assert http_client.post(f"/api/users/{user_id}/2fa/backup-codes").status_code == 422


def test_2fa_endpoints_reject_other_users(http_client: TestClient):
    other_id = register_and_get_id(http_client)
    register_and_login(http_client, user_name=SECOND_USER_NAME)

    response = http_client.post(f"/api/users/{other_id}/2fa/setup")

    assert response.status_code == 404
