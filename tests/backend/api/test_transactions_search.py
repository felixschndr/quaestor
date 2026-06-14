from datetime import date

import pytest
from fastapi.testclient import TestClient
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    create_credential,
    login_as,
    make_transaction,
    persist_account,
    persist_transaction,
    register,
)


def _seed_three_transactions(session_factory: sessionmaker, account_id: int) -> dict[str, int]:
    with session_factory() as session:
        rewe = make_transaction(
            session,
            account_id=account_id,
            amount=-12.50,
            purpose="Wocheneinkauf",
            other_party="Rewe",
            date=date(year=2026, month=1, day=15),
            transaction_type=TransactionType.OUTGOING,
            category=TransactionCategory.SUPERMARKET,
            note="weekly groceries",
        )
        salary = make_transaction(
            session,
            account_id=account_id,
            amount=2500.00,
            purpose="Gehalt April",
            other_party="ACME GmbH",
            date=date(year=2026, month=4, day=30),
            transaction_type=TransactionType.INCOMING,
            category=TransactionCategory.SALARY,
        )
        atm = make_transaction(
            session,
            account_id=account_id,
            amount=-200.00,
            purpose="ATM Berlin",
            other_party="Sparkasse",
            date=date(year=2026, month=5, day=2),
            transaction_type=TransactionType.OUTGOING,
            category=TransactionCategory.WITHDRAWAL,
            note="vacation cash",
        )
        session.commit()
        return {"rewe": rewe.id, "salary": salary.id, "atm": atm.id}


def _seed_linked_pair_and_single(session_factory: sessionmaker, account_id: int) -> dict[str, int]:
    """Two transactions linked as transfer counterparts plus one standalone."""
    with session_factory() as session:
        out = make_transaction(session, account_id=account_id, amount=-100.0, purpose="transfer out")
        back = make_transaction(session, account_id=account_id, amount=100.0, purpose="transfer in")
        session.flush()
        out.transfer_counterpart_id = back.id
        back.transfer_counterpart_id = out.id
        single = make_transaction(session, account_id=account_id, amount=-5.0, purpose="standalone")
        session.commit()
        return {"out": out.id, "back": back.id, "single": single.id}


def _ids_in_response(response_json: list[dict]) -> set[int]:
    return {row["id"] for row in response_json}


def test_search_returns_only_transactions_for_requested_account(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == set(ids.values())


def test_search_returns_account_id_on_every_row(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    for row in response.json():
        assert row["account_id"] == account_id


def test_search_spans_multiple_accounts(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    giro_id = persist_account(session_factory=session_factory, credential_id=credential_id, name="Giro")
    spar_id = persist_account(session_factory=session_factory, credential_id=credential_id, name="Sparkonto")
    on_giro = persist_transaction(session_factory=session_factory, account_id=giro_id, purpose="auf giro")
    on_spar = persist_transaction(session_factory=session_factory, account_id=spar_id, purpose="auf spar")

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", giro_id), ("account_ids", spar_id)],
    )

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == {on_giro, on_spar}


def test_search_only_returns_selected_accounts(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    giro_id = persist_account(session_factory=session_factory, credential_id=credential_id, name="Giro")
    spar_id = persist_account(session_factory=session_factory, credential_id=credential_id, name="Sparkonto")
    on_giro = persist_transaction(session_factory=session_factory, account_id=giro_id, purpose="auf giro")
    persist_transaction(session_factory=session_factory, account_id=spar_id, purpose="auf spar")

    response = http_client.get("/api/transactions/search", params=[("account_ids", giro_id)])

    assert _ids_in_response(response.json()) == {on_giro}


@pytest.mark.parametrize(
    argnames="extra_params, expected_keys",
    argvalues=[
        ([("text", "GEHALT")], {"salary"}),  # purpose, case-insensitive
        ([("text", "rewe")], {"rewe"}),  # also matches other_party
        ([("text", "vacation")], {"atm"}),  # also matches note
        ([("amount_from", 0), ("amount_to", 5000)], {"salary"}),
        ([("date_from", "2026-04-01"), ("date_to", "2026-04-30")], {"salary"}),
        ([("transaction_type", "OUTGOING")], {"rewe", "atm"}),
        ([("category", "WITHDRAWAL")], {"atm"}),
    ],
    ids=["text-purpose", "text-other-party", "text-note", "amount-range", "date-range", "transaction-type", "category"],
)
def test_search_filters_match_expected_transactions(
    http_client: TestClient,
    session_factory: sessionmaker,
    extra_params: list[tuple[str, object]],
    expected_keys: set[str],
):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), *extra_params],
    )

    assert _ids_in_response(response.json()) == {ids[key] for key in expected_keys}


def test_search_combines_filters_with_and(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[
            ("account_ids", account_id),
            ("transaction_type", "OUTGOING"),
            ("amount_from", -50),
        ],
    )

    assert [row["id"] for row in response.json()] == [ids["rewe"]]


def test_search_returns_empty_when_no_match(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("text", "no such transaction")],
    )

    assert response.status_code == 200
    assert response.json() == []


def test_search_rejects_unknown_transaction_type(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("transaction_type", "NOT_A_REAL_TYPE")],
    )

    assert response.status_code == 422


def test_search_rejects_unknown_category(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("category", "NOT_A_REAL_CATEGORY")],
    )

    assert response.status_code == 422


def test_search_rejects_account_owned_by_a_different_user(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 404


def test_search_rejects_when_only_some_accounts_are_owned(http_client: TestClient, session_factory: sessionmaker):
    # Owner has Account A, intruder has Account B. Intruder asks for both.
    # The endpoint must refuse the whole request (not silently filter A out).
    register(http_client, user_name="owner")
    owner_cred = create_credential(http_client).json()["id"]
    owner_account = persist_account(session_factory=session_factory, credential_id=owner_cred, name="Owner")

    register(http_client, user_name="intruder")
    login_as(http_client, user_name="intruder")
    intruder_cred = create_credential(http_client).json()["id"]
    intruder_account = persist_account(session_factory=session_factory, credential_id=intruder_cred, name="Intruder")

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", intruder_account), ("account_ids", owner_account)],
    )

    assert response.status_code == 404


def test_search_requires_at_least_one_account_id(http_client: TestClient):
    register(http_client)
    response = http_client.get("/api/transactions/search")
    assert response.status_code == 422


def test_search_requires_authentication(http_client: TestClient):
    response = http_client.get("/api/transactions/search", params=[("account_ids", 1)])
    assert response.status_code == 401


def test_search_linked_returns_only_transfer_transactions(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_linked_pair_and_single(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("linked", "linked")],
    )

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == {ids["out"], ids["back"]}


def test_search_unlinked_returns_only_standalone_transactions(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_linked_pair_and_single(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("linked", "unlinked")],
    )

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == {ids["single"]}


def test_search_without_linked_filter_returns_both(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    ids = _seed_linked_pair_and_single(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == set(ids.values())


def test_search_rejects_invalid_linked_value(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("linked", "maybe")],
    )

    assert response.status_code == 422
