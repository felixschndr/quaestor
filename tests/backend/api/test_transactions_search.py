from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.models.accounts.account_balance_snapshot import AccountBalanceSnapshot, BalanceSnapshotSource
from source.backend.models.transactions.transaction_attachment import TransactionAttachment
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import (
    create_credential,
    link_transactions_as_flow,
    make_transaction,
    persist_account,
    persist_transaction,
    register,
    register_and_login,
    setup_account,
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
        link_transactions_as_flow(db_session=session, transactions=[out, back])
        single = make_transaction(session, account_id=account_id, amount=-5.0, purpose="standalone")
        session.commit()
        return {"out": out.id, "back": back.id, "single": single.id}


def _seed_with_and_without_attachment(session_factory: sessionmaker, account_id: int) -> dict[str, int]:
    with session_factory() as session:
        with_att = make_transaction(session, account_id=account_id, amount=-9.0, purpose="invoice payment")
        without_att = make_transaction(session, account_id=account_id, amount=-4.0, purpose="cash")
        session.flush()
        session.add(
            TransactionAttachment(
                transaction_id=with_att.id,
                filename="Rechnung_2026.pdf",
                content_type="application/pdf",
                size=3,
                data=b"pdf",
                created_at=datetime.now(tz=timezone.utc),
            )
        )
        session.commit()
        return {"with": with_att.id, "without": without_att.id}


def _ids_in_response(response_json: list[dict]) -> set[int]:
    return {row["id"] for row in response_json}


def test_search_returns_only_transactions_for_requested_account(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == set(ids.values())


def test_search_returns_account_id_on_every_row(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
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


def test_search_flips_buy_sign_only_on_depot_accounts(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    cash_id = persist_account(session_factory=session_factory, credential_id=credential_id, name="Cash")
    depot_id = persist_account(session_factory=session_factory, credential_id=credential_id, name="Depot")
    persist_transaction(
        session_factory=session_factory, account_id=cash_id, amount=-3500.0, transaction_type=TransactionType.BUY
    )
    persist_transaction(
        session_factory=session_factory, account_id=depot_id, amount=-3500.0, transaction_type=TransactionType.BUY
    )
    with session_factory() as session:
        session.add(
            AccountBalanceSnapshot(
                account_id=depot_id,
                date=date(year=2026, month=1, day=15),
                balance=3500.0,
                source=BalanceSnapshotSource.MARKET_VALUED,
            )
        )
        session.commit()

    response = http_client.get("/api/transactions/search", params=[("account_ids", cash_id), ("account_ids", depot_id)])

    amounts = {row["account_id"]: row["amount"] for row in response.json()}
    assert amounts[cash_id] == -3500.0
    assert amounts[depot_id] == 3500.0


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
        ([("transaction_types", "OUTGOING")], {"rewe", "atm"}),
        ([("categories", "WITHDRAWAL")], {"atm"}),
    ],
)
def test_search_filters_match_expected_transactions(
    http_client: TestClient,
    session_factory: sessionmaker,
    extra_params: list[tuple[str, object]],
    expected_keys: set[str],
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), *extra_params],
    )

    assert _ids_in_response(response.json()) == {ids[key] for key in expected_keys}


def test_search_combines_filters_with_and(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[
            ("account_ids", account_id),
            ("transaction_types", "OUTGOING"),
            ("amount_from", -50),
        ],
    )

    assert [row["id"] for row in response.json()] == [ids["rewe"]]


def test_search_filters_by_multiple_categories(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("categories", "SUPERMARKET"), ("categories", "WITHDRAWAL")],
    )

    assert {row["id"] for row in response.json()} == {ids["rewe"], ids["atm"]}


def test_search_returns_empty_when_no_match(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("text", "no such transaction")],
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize(
    argnames="param, value",
    argvalues=[
        ("transaction_types", "NOT_A_REAL_TYPE"),
        ("categories", "NOT_A_REAL_CATEGORY"),
    ],
)
def test_search_rejects_unknown_enum_value(
    http_client: TestClient,
    session_factory: sessionmaker,
    param: str,
    value: str,
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), (param, value)],
    )

    assert response.status_code == 422


def test_search_rejects_account_owned_by_a_different_user(http_client: TestClient, session_factory: sessionmaker):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)
    _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    register_and_login(http_client, user_name="intruder")

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 404


def test_search_rejects_when_only_some_accounts_are_owned(http_client: TestClient, session_factory: sessionmaker):
    # Owner has Account A, intruder has Account B. Intruder asks for both.
    # The endpoint must refuse the whole request (not silently filter A out).
    register(http_client, user_name="owner")
    owner_cred = create_credential(http_client).json()["id"]
    owner_account = persist_account(session_factory=session_factory, credential_id=owner_cred, name="Owner")

    register_and_login(http_client, user_name="intruder")
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


@pytest.mark.parametrize(
    argnames="linked_value, expected_keys",
    argvalues=[
        ("linked", {"out", "back"}),
        ("unlinked", {"single"}),
    ],
)
def test_search_linked_filter_returns_matching_transactions(
    http_client: TestClient,
    session_factory: sessionmaker,
    linked_value: str,
    expected_keys: set[str],
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_linked_pair_and_single(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("linked", linked_value)],
    )

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == {ids[key] for key in expected_keys}


def test_search_without_linked_filter_returns_both(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_linked_pair_and_single(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/transactions/search", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == set(ids.values())


@pytest.mark.parametrize(
    argnames="param, value",
    argvalues=[
        ("linked", "maybe"),
        ("has_attachment", "maybe"),
    ],
)
def test_search_rejects_invalid_filter_value(
    http_client: TestClient,
    session_factory: sessionmaker,
    param: str,
    value: str,
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), (param, value)],
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    argnames="has_attachment_value, expected_key",
    argvalues=[
        ("with", "with"),
        ("without", "without"),
    ],
)
def test_search_has_attachment_filter_returns_matching_transactions(
    http_client: TestClient,
    session_factory: sessionmaker,
    has_attachment_value: str,
    expected_key: str,
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_with_and_without_attachment(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("has_attachment", has_attachment_value)],
    )

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == {ids[expected_key]}


def test_search_text_matches_attachment_filename(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_with_and_without_attachment(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/transactions/search",
        params=[("account_ids", account_id), ("text", "Rechnung")],
    )

    assert response.status_code == 200
    assert _ids_in_response(response.json()) == {ids["with"]}


def test_get_by_id_resolves_transaction_and_returns_account(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    response = http_client.get(f"/api/transactions/{ids['salary']}")

    assert response.status_code == 200
    assert response.json()["id"] == ids["salary"]
    assert response.json()["account_id"] == account_id


def test_get_by_id_hides_foreign_transaction(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    ids = _seed_three_transactions(session_factory=session_factory, account_id=account_id)

    register_and_login(http_client, user_name="intruder")
    response = http_client.get(f"/api/transactions/{ids['salary']}")

    assert response.status_code == 404
