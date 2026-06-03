from fastapi.testclient import TestClient
from source.backend.models.user import User
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    ACCOUNT_IBAN,
    SECOND_ACCOUNT_IBAN,
    make_account,
    make_credential,
    make_user,
    register,
)


def test_get_layout_returns_empty_when_user_has_no_accounts(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/account_groups/layout")

    assert response.status_code == 200
    assert response.json() == {"groups": [], "ungrouped": []}


def test_get_layout_returns_ungrouped_accounts_when_no_groups_exist(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        credential = make_credential(db_session, user_id=user.id)
        account_id_1 = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN).id
        account_id_2 = make_account(db_session, credential_id=credential.id, name=SECOND_ACCOUNT_IBAN).id
        db_session.commit()

    response = http_client.get("/api/account_groups/layout")

    assert response.status_code == 200
    body = response.json()
    assert body["groups"] == []
    assert sorted(item["id"] for item in body["ungrouped"]) == sorted([account_id_1, account_id_2])


def test_set_layout_creates_a_new_group_and_assigns_accounts(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        credential = make_credential(db_session, user_id=user.id)
        account_id_1 = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN).id
        account_id_2 = make_account(db_session, credential_id=credential.id, name=SECOND_ACCOUNT_IBAN).id
        db_session.commit()

    response = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "Sparen", "account_ids": [account_id_1]}], "ungrouped": [account_id_2]},
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["groups"]) == 1
    assert body["groups"][0]["name"] == "Sparen"
    assert body["groups"][0]["accounts"] == [{"id": account_id_1}]
    assert body["ungrouped"] == [{"id": account_id_2}]


def test_set_layout_renames_and_reorders_groups(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        credential = make_credential(db_session, user_id=user.id)
        account_id_1 = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN).id
        account_id_2 = make_account(db_session, credential_id=credential.id, name=SECOND_ACCOUNT_IBAN).id
        db_session.commit()

    initial = http_client.put(
        "/api/account_groups/layout",
        json={
            "groups": [
                {"name": "First", "account_ids": [account_id_1]},
                {"name": "Second", "account_ids": [account_id_2]},
            ],
            "ungrouped": [],
        },
    )
    assert initial.status_code == 200
    body = initial.json()
    group_id_1, group_id_2 = body["groups"][0]["id"], body["groups"][1]["id"]

    response = http_client.put(
        "/api/account_groups/layout",
        json={
            "groups": [
                {"id": group_id_2, "name": "Second renamed", "account_ids": [account_id_2]},
                {"id": group_id_1, "name": "First", "account_ids": [account_id_1]},
            ],
            "ungrouped": [],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert [g["id"] for g in body["groups"]] == [group_id_2, group_id_1]
    assert body["groups"][0]["name"] == "Second renamed"


def test_set_layout_deletes_groups_not_in_payload_and_orphans_become_ungrouped(
    http_client: TestClient, session_factory: sessionmaker
):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        credential = make_credential(db_session, user_id=user.id)
        account_id_1 = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN).id
        db_session.commit()

    initial = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "Soon to die", "account_ids": [account_id_1]}], "ungrouped": []},
    )
    assert initial.status_code == 200

    # Drop the group; move the account to ungrouped explicitly.
    response = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [], "ungrouped": [account_id_1]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["groups"] == []
    assert body["ungrouped"] == [{"id": account_id_1}]


def test_set_layout_rejects_account_id_not_owned_by_user(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        # Different user owns this account.
        other_user = make_user(db_session, user_name="otheruser", display_name="Other")
        other_cred = make_credential(db_session, user_id=other_user.id)
        foreign = make_account(db_session, credential_id=other_cred.id, name=SECOND_ACCOUNT_IBAN)
        # Our user has one of their own too, just to make sure the error message references the foreign one.
        my_cred = make_credential(db_session, user_id=user.id)
        mine = make_account(db_session, credential_id=my_cred.id, name=ACCOUNT_IBAN)
        db_session.commit()
        foreign_id, mine_id = foreign.id, mine.id

    response = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "Sneaky", "account_ids": [foreign_id, mine_id]}], "ungrouped": []},
    )
    assert response.status_code == 404


def test_set_layout_rejects_duplicate_account_ids(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        credential = make_credential(db_session, user_id=user.id)
        account_id_1 = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN).id
        db_session.commit()

    response = http_client.put(
        "/api/account_groups/layout",
        json={
            "groups": [
                {"name": "A", "account_ids": [account_id_1]},
                {"name": "B", "account_ids": [account_id_1]},
            ],
            "ungrouped": [],
        },
    )
    assert response.status_code == 422


def test_set_layout_rejects_unknown_group_id(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    with session_factory() as db_session:
        user = db_session.query(User).first()
        credential = make_credential(db_session, user_id=user.id)
        account_id_1 = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN).id
        db_session.commit()

    response = http_client.put(
        "/api/account_groups/layout",
        json={
            "groups": [{"id": 9999, "name": "Phantom", "account_ids": [account_id_1]}],
            "ungrouped": [],
        },
    )
    assert response.status_code == 404


def test_set_layout_rejects_empty_group_name(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)

    response = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "", "account_ids": []}], "ungrouped": []},
    )
    assert response.status_code == 422


def test_get_layout_requires_authentication(http_client: TestClient):
    assert http_client.get("/api/account_groups/layout").status_code == 401


def test_set_layout_requires_authentication(http_client: TestClient):
    assert http_client.put("/api/account_groups/layout", json={"groups": [], "ungrouped": []}).status_code == 401
