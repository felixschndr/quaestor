import pytest
from source.backend.services.session_service import COOKIE_NAME

VALID_PASSWORD = "Sup3rSecret!Pass"  # nosec: B105


def register(client, name="alice", password=VALID_PASSWORD):
    return client.post("/register", json={"name": name, "password": password})


def test_register_returns_created_user_and_sets_session_cookie(http_client):
    response = register(http_client)

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "alice"
    assert body["balance"] == 0.0
    assert COOKIE_NAME in response.cookies


def test_register_makes_first_user_admin_and_following_users_non_admin(http_client):
    first = register(http_client, name="first")
    second = register(http_client, name="second")

    assert first.json()["admin"] is True
    assert second.json()["admin"] is False


@pytest.mark.parametrize(
    argnames="password",
    argvalues=[
        "",
        "Ab1!Ab1!Ab1!",
        "aB1!aB1!aB1!aB",
        "alllowercaseletters",
        "ALLUPPERCASELETTERS",
        "123456789012345",
        "!!!!!!!!!!!!!!!",
        "lower1234567!!!",
        "UPPER1234567!!!",
        "lowerUPPER!!!!!",
        "lowerUPPER12345",
    ],
)
def test_register_rejects_invalid_password(http_client, password):
    response = register(http_client, password=password)

    assert response.status_code == 422


def test_login_succeeds_with_correct_credentials(http_client):
    register(http_client, name="bob")

    response = http_client.post("/login", json={"name": "bob", "password": VALID_PASSWORD})

    assert response.status_code == 200
    assert response.json()["name"] == "bob"
    assert COOKIE_NAME in response.cookies


def test_login_fails_with_wrong_password(http_client):
    register(http_client, name="carol")
    http_client.cookies.clear()

    response = http_client.post("/login", json={"name": "carol", "password": "Wr0ngPassword!!"})  # nosec: B105

    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_login_fails_for_unknown_user(http_client):
    response = http_client.post("/login", json={"name": "ghost", "password": VALID_PASSWORD})

    assert response.status_code == 401


def test_logout_returns_no_content_and_invalidates_session(http_client):
    register(http_client, name="dave")
    assert http_client.get("/users").status_code == 200

    logout_response = http_client.post("/logout")

    assert logout_response.status_code == 204
    assert http_client.get("/users").status_code == 401


def test_logout_without_session_cookie_is_idempotent(http_client):
    response = http_client.post("/logout")

    assert response.status_code == 204
