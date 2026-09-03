from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.models.banking.credential import Credential
from source.backend.services.banking import credential_service, sync_jobs
from source.backend.services.banking.credential_service import SyncResult, SyncStatus
from source.backend.services.banking.sync_jobs import JobErrorCode, JobStatus
from source.backend.services.notifications.notification_service import Notification
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    DEFAULT_BALANCE,
    DISPLAY_NAME,
    INTRUDER_USER_NAME,
    RECENT_DATE,
    RECIPIENT_ACCOUNT_NAME,
    SECOND_AMOUNT,
    SECOND_DISPLAY_NAME,
    SECOND_USER_NAME,
    THIRD_AMOUNT,
    USER_NAME,
    VALID_PASSWORD,
    WALLET_ACCOUNT_NAME,
    create_credential,
    login_as,
    make_account,
    register,
    register_and_login,
    setup_manual_account,
)


def _titles(sent: list[tuple[str, Notification]]) -> list[tuple[str, str]]:
    return [(user_name, notification.title) for user_name, notification in sent]


def _share(http_client: TestClient, account_id: int, recipient_id: int, permission: str = "write") -> int:
    response = http_client.post(
        f"/api/account_shares/account/{account_id}", json={"user_id": recipient_id, "permission": permission}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _setup(http_client: TestClient, permission: str = "write") -> tuple[int, int]:
    recipient_id = register(http_client, user_name=SECOND_USER_NAME, display_name=SECOND_DISPLAY_NAME).json()["id"]
    register_and_login(http_client)
    account_id = setup_manual_account(http_client)
    return account_id, _share(http_client, account_id=account_id, recipient_id=recipient_id, permission=permission)


def _accept(http_client: TestClient, share_id: int) -> None:
    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    assert http_client.post(f"/api/account_shares/{share_id}/accept").status_code == 204


def test_invitation_is_pending_until_answered(http_client: TestClient):
    account_id, share_id = _setup(http_client)

    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    me = http_client.get("/api/auth/me").json()
    assert [invitation["id"] for invitation in me["account_share_invitations"]] == [share_id]
    # Not accepted yet, so the account is invisible and untouchable.
    assert me["credentials"] == []
    assert http_client.get(f"/api/account/{account_id}/history").status_code == 404


def test_accepted_share_shows_up_as_a_stand_in_credential(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    _accept(http_client, share_id=share_id)

    me = http_client.get("/api/auth/me").json()
    assert me["account_share_invitations"] == []
    (credential,) = me["credentials"]
    assert credential["shared_from"] == DISPLAY_NAME
    assert credential["share_permission"] == "write"
    assert credential["sync_enabled"] is True
    assert [account["id"] for account in credential["accounts"]] == [account_id]
    assert http_client.get(f"/api/account/{account_id}/history").status_code == 200


def test_declining_removes_the_invitation(http_client: TestClient):
    _, share_id = _setup(http_client)

    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    assert http_client.post(f"/api/account_shares/{share_id}/decline").status_code == 204

    assert http_client.get("/api/auth/me").json()["account_share_invitations"] == []
    assert http_client.post(f"/api/account_shares/{share_id}/accept").status_code == 404


@pytest.mark.parametrize(argnames=("permission", "expected_status"), argvalues=[("write", 200), ("read", 403)])
def test_permission_gates_editing_a_note(http_client: TestClient, permission: str, expected_status: int):
    account_id, share_id = _setup(http_client, permission=permission)
    transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions", json={"amount": -DEFAULT_AMOUNT, "date": str(RECENT_DATE)}
    ).json()["id"]
    _accept(http_client, share_id=share_id)

    response = http_client.patch(
        f"/api/account/{account_id}/transactions/{transaction_id}", json={"note": "shared note"}
    )

    assert response.status_code == expected_status


def test_shared_writer_may_not_touch_owner_only_fields(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions", json={"amount": -DEFAULT_AMOUNT, "date": str(RECENT_DATE)}
    ).json()["id"]
    _accept(http_client, share_id=share_id)

    assert (
        http_client.patch(
            f"/api/account/{account_id}/transactions/{transaction_id}", json={"amount": -SECOND_AMOUNT}
        ).status_code
        == 403
    )
    assert (
        http_client.patch(f"/api/account/{account_id}", json={"display_name": RECIPIENT_ACCOUNT_NAME}).status_code
        == 403
    )
    assert http_client.delete(f"/api/account/{account_id}").status_code == 403


def test_shared_account_counts_towards_the_recipients_balance(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    http_client.patch(f"/api/account/{account_id}", json={"balance": DEFAULT_BALANCE})
    _accept(http_client, share_id=share_id)

    assert http_client.get("/api/auth/me").json()["balance"] == DEFAULT_BALANCE


def test_owner_can_change_the_permission_and_revoke(http_client: TestClient):
    account_id, share_id = _setup(http_client, permission="read")
    _accept(http_client, share_id=share_id)

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    assert (
        http_client.patch(f"/api/account_shares/{share_id}", json={"permission": "write"}).json()["permission"]
        == "write"
    )
    assert http_client.delete(f"/api/account_shares/{share_id}").status_code == 204
    assert http_client.get(f"/api/account_shares/account/{account_id}").json() == []


def test_recipient_can_leave_a_share(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    _accept(http_client, share_id=share_id)

    assert http_client.delete(f"/api/account_shares/account/{account_id}/mine").status_code == 204
    assert http_client.get("/api/auth/me").json()["credentials"] == []


def test_only_the_owner_manages_shares(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    _accept(http_client, share_id=share_id)

    assert http_client.get(f"/api/account_shares/account/{account_id}").status_code == 403
    assert http_client.delete(f"/api/account_shares/{share_id}").status_code == 403
    assert (
        http_client.post(
            f"/api/account_shares/account/{account_id}", json={"user_id": 1, "permission": "read"}
        ).status_code
        == 403
    )


def test_shareable_users_excludes_the_caller(http_client: TestClient):
    register(http_client, user_name=SECOND_USER_NAME, display_name=SECOND_DISPLAY_NAME)
    register_and_login(http_client)

    users = http_client.get("/api/account_shares/users").json()

    assert [user["display_name"] for user in users] == [SECOND_DISPLAY_NAME]
    assert "user_name" not in users[0]


def test_owner_still_sees_the_share_after_it_was_accepted(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    _accept(http_client, share_id=share_id)

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    shares = http_client.get(f"/api/account_shares/account/{account_id}").json()

    assert [(entry["id"], entry["status"]) for entry in shares] == [(share_id, "accepted")]


def test_recipient_keeps_their_own_name_and_balance_factor(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    http_client.patch(
        f"/api/account/{account_id}", json={"balance": DEFAULT_BALANCE, "display_name": WALLET_ACCOUNT_NAME}
    )
    _accept(http_client, share_id=share_id)

    updated = http_client.patch(
        f"/api/account_shares/account/{account_id}/mine",
        json={"display_name": RECIPIENT_ACCOUNT_NAME, "balance_factor": 50},
    )

    assert updated.status_code == 200, updated.text
    me = http_client.get("/api/auth/me").json()
    (account,) = me["credentials"][0]["accounts"]
    assert account["display_name"] == RECIPIENT_ACCOUNT_NAME
    assert account["balance_factor"] == 50
    assert me["balance"] == DEFAULT_BALANCE / 2


def test_recipient_settings_do_not_touch_the_owners_account(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    http_client.patch(f"/api/account/{account_id}", json={"display_name": WALLET_ACCOUNT_NAME})
    _accept(http_client, share_id=share_id)
    http_client.patch(
        f"/api/account_shares/account/{account_id}/mine",
        json={"display_name": RECIPIENT_ACCOUNT_NAME, "balance_factor": 25},
    )

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)

    (account,) = http_client.get("/api/auth/me").json()["credentials"][0]["accounts"]
    assert account["display_name"] == WALLET_ACCOUNT_NAME
    assert account["balance_factor"] == 100.0


def test_both_sides_are_notified_along_the_whole_lifecycle(
    http_client: TestClient, sent_notifications: list[tuple[str, Notification]]
):
    account_id, share_id = _setup(http_client, permission="read")
    assert _titles(sent_notifications) == [(SECOND_USER_NAME, "Account shared with you")]

    _accept(http_client, share_id=share_id)
    assert _titles(sent_notifications)[-1] == (USER_NAME, "Share accepted")

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    http_client.patch(f"/api/account_shares/{share_id}", json={"permission": "write"})
    assert _titles(sent_notifications)[-1] == (SECOND_USER_NAME, "Share permission changed")

    http_client.delete(f"/api/account_shares/{share_id}")
    assert _titles(sent_notifications)[-1] == (SECOND_USER_NAME, "Share revoked")
    assert account_id > 0


def test_owner_is_notified_when_the_recipient_leaves(
    http_client: TestClient, sent_notifications: list[tuple[str, Notification]]
):
    account_id, share_id = _setup(http_client)
    _accept(http_client, share_id=share_id)

    http_client.delete(f"/api/account_shares/account/{account_id}/mine")

    assert _titles(sent_notifications)[-1] == (USER_NAME, "Share left")


def test_owner_is_notified_when_the_recipient_declines(
    http_client: TestClient, sent_notifications: list[tuple[str, Notification]]
):
    _, share_id = _setup(http_client)

    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    http_client.post(f"/api/account_shares/{share_id}/decline")

    assert _titles(sent_notifications)[-1] == (USER_NAME, "Share declined")


def test_every_share_notification_links_where_the_recipient_can_act(
    http_client: TestClient, sent_notifications: list[tuple[str, Notification]]
):
    account_id, share_id = _setup(http_client, permission="read")
    credential_id = http_client.get("/api/auth/me").json()["credentials"][0]["id"]

    assert sent_notifications[-1][1].url == "/settings"

    _accept(http_client, share_id=share_id)
    assert sent_notifications[-1][1].url == f"/settings/credentials/{credential_id}"

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    http_client.patch(f"/api/account_shares/{share_id}", json={"permission": "write"})
    assert sent_notifications[-1][1].url == f"/account/{account_id}"

    http_client.delete(f"/api/account_shares/{share_id}")
    assert sent_notifications[-1][1].url == "/settings"


def test_share_notifications_are_tagged_per_share_so_they_do_not_replace_each_other(
    http_client: TestClient, sent_notifications: list[tuple[str, Notification]]
):
    account_id, first_share = _setup(http_client)
    third_user_id = register(http_client, user_name=INTRUDER_USER_NAME, display_name=SECOND_DISPLAY_NAME).json()["id"]
    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    second_share = _share(http_client, account_id=account_id, recipient_id=third_user_id)

    tags = [notification.tag for _, notification in sent_notifications]
    assert tags == [f"account-share-{first_share}", f"account-share-{second_share}"]


def test_recipient_keeps_their_own_overview_preferences(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    http_client.patch(f"/api/account/{account_id}", json={"balance": DEFAULT_BALANCE})
    _accept(http_client, share_id=share_id)

    http_client.patch(
        f"/api/account_shares/account/{account_id}/mine",
        json={"is_hidden": True, "include_by_default": False},
    )

    me = http_client.get("/api/auth/me").json()
    (account,) = me["credentials"][0]["accounts"]
    assert account["is_hidden"] is True
    assert account["include_by_default"] is False
    assert me["balance"] == 0.0

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    (owned,) = http_client.get("/api/auth/me").json()["credentials"][0]["accounts"]
    assert owned["is_hidden"] is False
    assert owned["include_by_default"] is True


def test_recipient_may_sync_the_shared_credential(http_client: TestClient):
    account_id, share_id = _setup(http_client, permission="write")
    credential_id = http_client.get("/api/auth/me").json()["credentials"][0]["id"]
    owner_status = http_client.post(f"/api/credentials/{credential_id}/sync").status_code
    _accept(http_client, share_id=share_id)

    recipient_status = http_client.post(f"/api/credentials/{credential_id}/sync").status_code

    assert recipient_status == owner_status
    assert account_id > 0


def test_a_stranger_still_cannot_sync_the_credential(http_client: TestClient):
    register_and_login(http_client)
    account_id = setup_manual_account(http_client)
    credential_id = http_client.get("/api/auth/me").json()["credentials"][0]["id"]
    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

    assert http_client.post(f"/api/credentials/{credential_id}/sync").status_code == 404
    assert http_client.get(f"/api/account/{account_id}/history").status_code == 404


def test_recipient_may_not_sync_a_credential_that_needs_a_second_factor(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id, share_id = _setup(http_client)
    credential_id = http_client.get("/api/auth/me").json()["credentials"][0]["id"]
    with session_factory() as db_session:
        credential = db_session.get(entity=Credential, ident=credential_id)
        credential.requires_two_factor_authentication = True
        db_session.commit()
    _accept(http_client, share_id=share_id)

    assert http_client.get(f"/api/account/{account_id}/history").status_code == 200
    assert http_client.post(f"/api/credentials/{credential_id}/sync").status_code == 403


def test_recipient_sees_the_owners_last_sync_timestamp(http_client: TestClient, session_factory: sessionmaker):
    _, share_id = _setup(http_client)
    credential_id = http_client.get("/api/auth/me").json()["credentials"][0]["id"]
    with session_factory() as db_session:
        credential = db_session.get(entity=Credential, ident=credential_id)
        credential.last_fetching_timestamp = datetime(
            year=2026, month=8, day=30, hour=9, minute=30, tzinfo=timezone.utc
        )
        db_session.commit()
    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    (owner_read,) = http_client.get("/api/auth/me").json()["credentials"]
    _accept(http_client, share_id=share_id)

    (recipient_read,) = http_client.get("/api/auth/me").json()["credentials"]

    assert recipient_read["last_fetching_timestamp"] == owner_read["last_fetching_timestamp"]
    assert recipient_read["last_fetching_timestamp"] is not None


def test_read_only_recipient_may_not_sync_the_shared_credential(http_client: TestClient):
    account_id, share_id = _setup(http_client, permission="read")
    credential_id = http_client.get("/api/auth/me").json()["credentials"][0]["id"]
    _accept(http_client, share_id=share_id)

    assert http_client.get(f"/api/account/{account_id}/history").status_code == 200
    assert http_client.post(f"/api/credentials/{credential_id}/sync").status_code == 403


def test_flow_members_on_foreign_accounts_stay_hidden(http_client: TestClient):
    account_id, share_id = _setup(http_client, permission="read")
    private_account_id = setup_manual_account(http_client)
    shared_transaction_id = http_client.post(
        f"/api/account/{account_id}/transactions", json={"amount": -THIRD_AMOUNT, "date": str(RECENT_DATE)}
    ).json()["id"]
    private_transaction_id = http_client.post(
        f"/api/account/{private_account_id}/transactions", json={"amount": THIRD_AMOUNT, "date": str(RECENT_DATE)}
    ).json()["id"]
    linked = http_client.put(
        f"/api/account/{account_id}/transactions/{shared_transaction_id}/transfer-link",
        json={
            "counterpart_account_id": private_account_id,
            "counterpart_transaction_id": private_transaction_id,
        },
    )
    assert [member["id"] for member in linked.json()["flow_members"]] == [private_transaction_id]
    _accept(http_client, share_id=share_id)

    detail = http_client.get(f"/api/account/{account_id}/transactions/{shared_transaction_id}").json()

    assert detail["flow_members"] == []
    assert http_client.get(f"/api/transactions/{private_transaction_id}").status_code == 404


def test_pending_share_hands_out_no_balance(http_client: TestClient):
    account_id, _ = _setup(http_client)

    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)

    assert http_client.patch(f"/api/account_shares/account/{account_id}/mine", json={}).status_code == 404
    assert http_client.delete(f"/api/account_shares/account/{account_id}/mine").status_code == 404


def test_read_only_share_hides_the_owners_sync_jobs(
    http_client: TestClient, session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )
    recipient_id = register(http_client, user_name=SECOND_USER_NAME, display_name=SECOND_DISPLAY_NAME).json()["id"]
    register_and_login(http_client)
    credential_id = create_credential(http_client).json()["id"]
    with session_factory() as db_session:
        account_id = make_account(db_session, credential_id=credential_id).id
        db_session.commit()
    share_id = _share(http_client, account_id=account_id, recipient_id=recipient_id, permission="read")
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]
    _accept(http_client, share_id=share_id)

    assert job_id not in {job["job_id"] for job in http_client.get("/api/credentials/sync").json()}


def test_a_write_recipient_sees_no_bank_internals_on_the_owners_sync_job(
    http_client: TestClient, session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        target=credential_service, name="sync_credential", value=lambda **_: SyncResult(status=SyncStatus.COMPLETED)
    )
    recipient_id = register(http_client, user_name=SECOND_USER_NAME, display_name=SECOND_DISPLAY_NAME).json()["id"]
    register_and_login(http_client)
    credential_id = create_credential(http_client).json()["id"]
    with session_factory() as db_session:
        account_id = make_account(db_session, credential_id=credential_id).id
        db_session.commit()
    share_id = _share(http_client, account_id=account_id, recipient_id=recipient_id, permission="write")
    job_id = http_client.post(f"/api/credentials/{credential_id}/sync").json()["job_id"]
    job = sync_jobs.get_job_by_id(job_id)
    job.status = JobStatus.AWAITING_TWO_FACTOR
    job.error = "Login failed for alice.private@bank.example (IBAN DE02...3000)"
    job.error_code = JobErrorCode.INVALID_CREDENTIALS
    job.authorization_url = "https://bank.example/device?user_code=ABCD-EFGH"
    job.device_code = "ABCD-EFGH"
    _accept(http_client, share_id=share_id)

    read = http_client.get(f"/api/credentials/{credential_id}/sync/{job_id}").json()

    assert read["error"] is None
    assert read["authorization_url"] is None
    assert read["device_code"] is None
    assert read["error_code"] == JobErrorCode.INVALID_CREDENTIALS.value
    listed = next(j for j in http_client.get("/api/credentials/sync").json() if j["job_id"] == job_id)
    assert (listed["error"], listed["device_code"]) == (None, None)
    two_factor = http_client.post(f"/api/credentials/{credential_id}/sync/{job_id}/2fa", json={"code": "000000"})
    assert two_factor.status_code == 403, two_factor.text


def test_recipient_groups_a_shared_account_without_moving_the_owners_layout(http_client: TestClient):
    account_id, share_id = _setup(http_client)
    _accept(http_client, share_id=share_id)

    assert [ref["id"] for ref in http_client.get("/api/account_groups/layout").json()["ungrouped"]] == [account_id]
    saved = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "Household", "account_ids": [account_id]}], "ungrouped": []},
    )

    assert saved.status_code == 200, saved.text
    (group,) = saved.json()["groups"]
    assert (group["name"], [ref["id"] for ref in group["accounts"]]) == ("Household", [account_id])

    login_as(http_client, user_name=USER_NAME, password=VALID_PASSWORD)
    owner_layout = http_client.get("/api/account_groups/layout").json()
    assert owner_layout["groups"] == []
    assert [ref["id"] for ref in owner_layout["ungrouped"]] == [account_id]


def test_a_pending_share_cannot_be_grouped(http_client: TestClient):
    account_id, _ = _setup(http_client)

    login_as(http_client, user_name=SECOND_USER_NAME, password=VALID_PASSWORD)
    response = http_client.put(
        "/api/account_groups/layout",
        json={"groups": [{"name": "Household", "account_ids": [account_id]}], "ungrouped": []},
    )

    assert response.status_code == 404, response.text
