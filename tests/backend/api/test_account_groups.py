from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    ACCOUNT_IBAN,
    SECOND_ACCOUNT_IBAN,
    SECOND_USER_NAME,
    UNKNOWN_ID,
    WALLET_ACCOUNT_NAME,
    assert_log_contains,
    create_credential,
    persist_account,
    register,
    register_and_login,
    setup_account,
)


def _setup_two_accounts(http_client: TestClient, session_factory: sessionmaker) -> tuple[int, int]:
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    return (
        persist_account(session_factory=session_factory, credential_id=credential_id, name=ACCOUNT_IBAN),
        persist_account(session_factory=session_factory, credential_id=credential_id, name=SECOND_ACCOUNT_IBAN),
    )


def test_get_layout_returns_empty_when_user_has_no_accounts(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/account_groups/layout")

    assert response.status_code == 200
    assert response.json() == {"groups": [], "ungrouped": []}


def test_get_layout_returns_ungrouped_accounts_when_no_groups_exist(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id_1, account_id_2 = _setup_two_accounts(http_client=http_client, session_factory=session_factory)

    response = http_client.get("/api/account_groups/layout")

    assert response.status_code == 200
    body = response.json()
    assert body["groups"] == []
    assert sorted(item["id"] for item in body["ungrouped"]) == sorted([account_id_1, account_id_2])


def test_set_layout_creates_a_new_group_and_assigns_accounts(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id_1, account_id_2 = _setup_two_accounts(http_client=http_client, session_factory=session_factory)

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
    assert_log_contains(caplog, message="layout: 1 group(s) (1 created, 0 deleted), 1 ungrouped account(s)")


def test_set_layout_renames_and_reorders_groups(http_client: TestClient, session_factory: sessionmaker):
    account_id_1, account_id_2 = _setup_two_accounts(http_client=http_client, session_factory=session_factory)

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
    account_id_1 = setup_account(http_client=http_client, session_factory=session_factory)

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
    foreign_id = setup_account(http_client=http_client, session_factory=session_factory)
    # Our user has one of their own too, just to make sure the error message references the foreign one.
    register_and_login(http_client, user_name=SECOND_USER_NAME)
    mine_id = persist_account(
        session_factory=session_factory, credential_id=create_credential(http_client).json()["id"]
    )

    response = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "Sneaky", "account_ids": [foreign_id, mine_id]}], "ungrouped": []},
    )
    assert response.status_code == 404


@pytest.mark.parametrize(
    argnames=("layout", "expected_status"),
    argvalues=[
        (
            lambda account_id: {
                "groups": [{"name": "A", "account_ids": [account_id]}, {"name": "B", "account_ids": [account_id]}],
                "ungrouped": [],
            },
            422,
        ),
        (
            lambda account_id: {
                "groups": [{"name": WALLET_ACCOUNT_NAME, "account_ids": [account_id]}],
                "ungrouped": [account_id],
            },
            422,
        ),
        (
            lambda account_id: {
                "groups": [{"id": UNKNOWN_ID, "name": "Phantom", "account_ids": [account_id]}],
                "ungrouped": [],
            },
            404,
        ),
        (lambda account_id: {"groups": [{"name": "", "account_ids": []}], "ungrouped": [account_id]}, 422),
    ],
)
def test_set_layout_rejects_invalid_layout(
    http_client: TestClient,
    session_factory: sessionmaker,
    layout: Callable[[int], dict],
    expected_status: int,
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.put("/api/account_groups/layout", json=layout(account_id))

    assert response.status_code == expected_status
