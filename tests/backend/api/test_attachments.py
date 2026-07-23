import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.services.transactions import attachment_service
from tests.backend.conftest import (
    persist_transaction,
    register_and_login,
    setup_account,
)


def _upload(http_client: TestClient, account_id: int, transaction_id: int, name: str, content: bytes) -> httpx.Response:
    return http_client.post(
        f"/api/account/{account_id}/transactions/{transaction_id}/attachments",
        files=[("files", (name, content, "application/octet-stream"))],
    )


def test_upload_list_download_delete_roundtrip(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    upload = _upload(
        http_client=http_client,
        account_id=account_id,
        transaction_id=transaction_id,
        name="receipt.pdf",
        content=b"%PDF-1.4 hello",
    )
    assert upload.status_code == 201
    attachment_id = upload.json()[0]["id"]
    assert upload.json()[0]["filename"] == "receipt.pdf"
    assert upload.json()[0]["size"] == len(b"%PDF-1.4 hello")

    listing = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}/attachments")
    assert [a["id"] for a in listing.json()] == [attachment_id]

    download = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}/attachments/{attachment_id}")
    assert download.status_code == 200
    assert download.content == b"%PDF-1.4 hello"
    assert "receipt.pdf" in download.headers["content-disposition"]

    deleted = http_client.delete(f"/api/account/{account_id}/transactions/{transaction_id}/attachments/{attachment_id}")
    assert deleted.status_code == 204
    assert http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}/attachments").json() == []


def test_multiple_files_in_one_upload(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = http_client.post(
        f"/api/account/{account_id}/transactions/{transaction_id}/attachments",
        files=[
            ("files", ("a.pdf", b"one", "application/pdf")),
            ("files", ("b.png", b"two", "image/png")),
        ],
    )
    assert response.status_code == 201
    assert {a["filename"] for a in response.json()} == {"a.pdf", "b.png"}


def test_disallowed_extension_returns_415(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = _upload(
        http_client=http_client, account_id=account_id, transaction_id=transaction_id, name="evil.exe", content=b"MZ"
    )
    assert response.status_code == 415


def test_oversized_file_returns_413(
    http_client: TestClient, session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv(name=attachment_service.MAX_ATTACHMENT_SIZE_MB_ENV_VARIABLE_NAME, value="1")
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)

    response = _upload(
        http_client=http_client,
        account_id=account_id,
        transaction_id=transaction_id,
        name="big.pdf",
        content=b"x" * (2 * 1024 * 1024),
    )
    assert response.status_code == 413


def test_attachment_of_other_user_is_not_accessible(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    transaction_id = persist_transaction(session_factory=session_factory, account_id=account_id)
    attachment_id = _upload(
        http_client=http_client, account_id=account_id, transaction_id=transaction_id, name="receipt.pdf", content=b"x"
    ).json()[0]["id"]

    register_and_login(http_client, user_name="intruder")
    response = http_client.get(f"/api/account/{account_id}/transactions/{transaction_id}/attachments/{attachment_id}")
    assert response.status_code == 404
