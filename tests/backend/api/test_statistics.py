import logging
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from source.backend.constants import API_PREFIX
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    DEFAULT_BALANCE,
    INTRUDER_USER_NAME,
    LARGE_AMOUNT,
    REWE,
    SECOND_AMOUNT,
    THIRD_AMOUNT,
    assert_log_contains,
    create_credential,
    link_transactions_as_flow,
    make_transaction,
    persist_account,
    persist_transaction,
    register,
    register_and_login,
    seed_for_categories,
    seed_snapshot,
    setup_account,
)

STATISTICS_ENDPOINTS = (
    f"{API_PREFIX}/statistics/categories",
    f"{API_PREFIX}/statistics/cashflow",
    f"{API_PREFIX}/statistics/net-savings",
    f"{API_PREFIX}/statistics/other-parties",
    f"{API_PREFIX}/statistics/net-worth",
)


def test_categories_sums_expenses_by_category_excluding_income(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_for_categories(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/categories", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert response.json() == [
        {"category": "SUPERMARKET", "total": 2 * DEFAULT_AMOUNT},
        {"category": "RESTAURANTS", "total": DEFAULT_AMOUNT},
    ]


def test_categories_income_direction_returns_only_incoming(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_for_categories(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/statistics/categories", params=[("account_ids", account_id), ("direction", "INCOMING")]
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "SALARY", "total": DEFAULT_AMOUNT}]


def test_categories_logs_with_user_object(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_for_categories(session_factory=session_factory, account_id=account_id)

    with caplog.at_level(logging.DEBUG, logger="services.transactions.statistics_service"):
        http_client.get("/api/statistics/categories", params=[("account_ids", account_id)])

    assert_log_contains(caplog=caplog, messages=["category breakdown", "<User("])


def test_categories_respects_date_range(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(
            session,
            account_id=account_id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.FUEL,
            date=date(year=2026, month=1, day=10),
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.FUEL,
            date=date(year=2026, month=3, day=10),
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("date_from", "2026-01-01"), ("date_to", "2026-01-31")],
    )

    assert response.json() == [{"category": "FUEL", "total": DEFAULT_AMOUNT}]


@pytest.mark.parametrize(
    argnames=("param", "value"), argvalues=[("direction", "sideways"), ("transaction_types", "NONSENSE")]
)
def test_categories_rejects_invalid_filter(
    http_client: TestClient, session_factory: sessionmaker, param: str, value: str
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    response = http_client.get("/api/statistics/categories", params=[("account_ids", account_id), (param, value)])
    assert response.status_code == 422


def test_categories_hide_net_zero_transfers(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        out = make_transaction(
            session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.SAVINGS
        )
        back = make_transaction(
            session, account_id=account_id, amount=DEFAULT_AMOUNT, category=TransactionCategory.SAVINGS
        )
        session.flush()
        link_transactions_as_flow(db_session=session, transactions=[out, back])
        make_transaction(
            session,
            account_id=account_id,
            amount=LARGE_AMOUNT,
            category=TransactionCategory.SALARY,
            transaction_type=TransactionType.TRANSFER_IN,
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories", params=[("account_ids", account_id), ("direction", "INCOMING")]
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "SALARY", "total": LARGE_AMOUNT}]


def test_categories_filter_by_transaction_type(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(
            session,
            account_id=account_id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.FUEL,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.FEES,
            transaction_type=TransactionType.FEES,
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("transaction_types", "FEES")],
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "FEES", "total": DEFAULT_AMOUNT}]


def test_categories_filter_by_multiple_transaction_types(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(
            session,
            account_id=account_id,
            amount=-THIRD_AMOUNT,
            category=TransactionCategory.FUEL,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-SECOND_AMOUNT,
            category=TransactionCategory.FEES,
            transaction_type=TransactionType.FEES,
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.GIFTS,
            transaction_type=TransactionType.BUY,
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("transaction_types", "FEES"), ("transaction_types", "OUTGOING")],
    )

    assert response.status_code == 200
    assert response.json() == [
        {"category": "FEES", "total": SECOND_AMOUNT},
        {"category": "FUEL", "total": THIRD_AMOUNT},
    ]


def test_categories_hide_net_zero_flows_but_keep_flows_with_net_effect(
    http_client: TestClient, session_factory: sessionmaker
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        transfer_out = make_transaction(
            session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.SAVINGS
        )
        transfer_in = make_transaction(
            session, account_id=account_id, amount=DEFAULT_AMOUNT, category=TransactionCategory.SAVINGS
        )
        returned_payment = make_transaction(
            session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.FEES
        )
        reimbursement = make_transaction(
            session, account_id=account_id, amount=DEFAULT_AMOUNT, category=TransactionCategory.REIMBURSEMENT
        )
        successful_retry = make_transaction(
            session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.FEES
        )
        session.flush()
        link_transactions_as_flow(db_session=session, transactions=[transfer_out, transfer_in])
        link_transactions_as_flow(db_session=session, transactions=[returned_payment, reimbursement, successful_retry])
        session.commit()

    response = http_client.get("/api/statistics/categories", params=[("account_ids", account_id)])

    assert response.status_code == 200
    # SAVINGS transfer gone; the returned FEES payment + reimbursement cancel, leaving the single real retry.
    assert response.json() == [{"category": "FEES", "total": DEFAULT_AMOUNT}]


def test_categories_filter_restricts_results(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=-THIRD_AMOUNT, category=TransactionCategory.FUEL)
        make_transaction(session, account_id=account_id, amount=-SECOND_AMOUNT, category=TransactionCategory.RENT)
        make_transaction(session, account_id=account_id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.GIFTS)
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("categories", "FUEL"), ("categories", "RENT")],
    )

    assert response.status_code == 200
    assert response.json() == [
        {"category": "RENT", "total": SECOND_AMOUNT},
        {"category": "FUEL", "total": THIRD_AMOUNT},
    ]


def _seed_two_months(session_factory: sessionmaker, account_id: int) -> None:
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=LARGE_AMOUNT, date=date(year=2026, month=1, day=31))
        make_transaction(session, account_id=account_id, amount=-SECOND_AMOUNT, date=date(year=2026, month=1, day=15))
        make_transaction(session, account_id=account_id, amount=-THIRD_AMOUNT, date=date(year=2026, month=2, day=5))
        make_transaction(
            session, account_id=account_id, amount=-DEFAULT_AMOUNT, date=date(year=2026, month=1, day=20), pending=True
        )
        session.commit()


def test_cashflow_splits_income_and_expenses_per_month(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_two_months(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/cashflow", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert response.json() == [
        {"month": "2026-01", "income": LARGE_AMOUNT, "expenses": SECOND_AMOUNT},
        {"month": "2026-02", "income": 0.0, "expenses": THIRD_AMOUNT},
    ]


def test_net_savings_computes_net_and_rate_per_month(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_two_months(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/net-savings", params=[("account_ids", account_id)])

    assert response.status_code == 200
    body = response.json()
    # 2026-01: net = 3500 - 20 = 3480; rate = 3480 / 3500 * 100 = 99.43%.
    assert body[0] == {"month": "2026-01", "net": LARGE_AMOUNT - SECOND_AMOUNT, "savings_rate": 99.43}
    # 2026-02: no income → net negative, savings_rate clamped to 0.0 (no divide-by-zero).
    assert body[1] == {"month": "2026-02", "net": -THIRD_AMOUNT, "savings_rate": 0.0}


def _seed_other_parties(session_factory: sessionmaker, account_id: int) -> None:
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=-THIRD_AMOUNT, other_party=REWE)
        make_transaction(session, account_id=account_id, amount=-THIRD_AMOUNT, other_party=REWE)
        make_transaction(session, account_id=account_id, amount=-DEFAULT_AMOUNT, other_party="Edeka")
        make_transaction(session, account_id=account_id, amount=-THIRD_AMOUNT, other_party="Amazon")
        make_transaction(session, account_id=account_id, amount=LARGE_AMOUNT, other_party="Employer")
        make_transaction(session, account_id=account_id, amount=-DEFAULT_AMOUNT, other_party=None)
        make_transaction(session, account_id=account_id, amount=-DEFAULT_AMOUNT, other_party="")
        session.commit()


def test_other_parties_orders_by_total_desc(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_other_parties(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/other-parties", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert response.json() == [
        {"other_party": "Edeka", "total": DEFAULT_AMOUNT},
        {"other_party": REWE, "total": SECOND_AMOUNT},
        {"other_party": "Amazon", "total": THIRD_AMOUNT},
    ]


def test_other_parties_income_direction(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_other_parties(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/statistics/other-parties", params=[("account_ids", account_id), ("direction", "INCOMING")]
    )

    assert response.json() == [{"other_party": "Employer", "total": LARGE_AMOUNT}]


def test_statistics_span_multiple_accounts(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    giro = persist_account(session_factory=session_factory, credential_id=credential_id, name="Giro")
    spar = persist_account(session_factory=session_factory, credential_id=credential_id, name="Sparkonto")
    with session_factory() as session:
        make_transaction(session, account_id=giro, amount=-DEFAULT_AMOUNT, category=TransactionCategory.FUEL)
        make_transaction(session, account_id=spar, amount=-DEFAULT_AMOUNT, category=TransactionCategory.FUEL)
        session.commit()

    response = http_client.get("/api/statistics/categories", params=[("account_ids", giro), ("account_ids", spar)])

    assert response.json() == [{"category": "FUEL", "total": 2 * DEFAULT_AMOUNT}]


def test_net_worth_carries_forward_latest_snapshot_per_day(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_snapshot(
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=1, day=1), balance=1000.0
    )
    seed_snapshot(
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=1, day=3), balance=1200.0
    )

    response = http_client.get(
        "/api/statistics/net-worth",
        params=[("account_ids", account_id), ("date_from", "2026-01-01"), ("date_to", "2026-01-05")],
    )

    assert response.status_code == 200
    assert response.json() == {
        "series": [
            {"date": "2026-01-01", "value": 1000.0},
            {"date": "2026-01-02", "value": 1000.0},
            {"date": "2026-01-03", "value": 1200.0},
            {"date": "2026-01-04", "value": 1200.0},
            {"date": "2026-01-05", "value": 1200.0},
        ],
        "summary": {"minimum": 1000.0, "average": 1120.0, "maximum": 1200.0},
    }


def test_net_worth_uses_anchor_before_date_from(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_snapshot(
        session_factory=session_factory, account_id=account_id, day=date(year=2025, month=12, day=20), balance=500.0
    )
    seed_snapshot(
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=1, day=2), balance=750.0
    )

    response = http_client.get(
        "/api/statistics/net-worth",
        params=[("account_ids", account_id), ("date_from", "2026-01-01"), ("date_to", "2026-01-03")],
    )

    assert response.status_code == 200
    assert response.json() == {
        "series": [
            {"date": "2026-01-01", "value": 500.0},
            {"date": "2026-01-02", "value": 750.0},
            {"date": "2026-01-03", "value": 750.0},
        ],
        "summary": {"minimum": 500.0, "average": 666.67, "maximum": 750.0},
    }


def test_net_worth_sums_across_accounts_applying_balance_factor(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    giro = persist_account(session_factory=session_factory, credential_id=credential_id, name="Giro")
    shared = persist_account(
        session_factory=session_factory, credential_id=credential_id, name="Joint", balance_factor=50
    )
    seed_snapshot(session_factory=session_factory, account_id=giro, day=date(year=2026, month=1, day=1), balance=1000.0)
    seed_snapshot(
        session_factory=session_factory, account_id=shared, day=date(year=2026, month=1, day=1), balance=400.0
    )

    response = http_client.get(
        "/api/statistics/net-worth",
        params=[
            ("account_ids", giro),
            ("account_ids", shared),
            ("date_from", "2026-01-01"),
            ("date_to", "2026-01-01"),
        ],
    )

    # 1000 + (400 * 50 / 100) = 1200
    assert response.json() == {
        "series": [{"date": "2026-01-01", "value": 1200.0}],
        "summary": {"minimum": 1200.0, "average": 1200.0, "maximum": 1200.0},
    }


def test_net_worth_skips_days_with_no_anchor(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_snapshot(
        session_factory=session_factory,
        account_id=account_id,
        day=date(year=2026, month=1, day=3),
        balance=DEFAULT_BALANCE,
    )

    response = http_client.get(
        "/api/statistics/net-worth",
        params=[("account_ids", account_id), ("date_from", "2026-01-01"), ("date_to", "2026-01-04")],
    )

    # 2026-01-01 and 2026-01-02 have no anchor; series starts at the first day with data.
    assert response.json() == {
        "series": [
            {"date": "2026-01-03", "value": 100.0},
            {"date": "2026-01-04", "value": 100.0},
        ],
        "summary": {"minimum": 100.0, "average": 100.0, "maximum": 100.0},
    }


def test_net_worth_returns_empty_without_snapshots(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    response = http_client.get(
        "/api/statistics/net-worth",
        params=[("account_ids", account_id), ("date_from", "2026-01-01"), ("date_to", "2026-01-05")],
    )
    assert response.status_code == 200
    assert response.json() == {"series": [], "summary": None}


@pytest.mark.parametrize(argnames="endpoint", argvalues=STATISTICS_ENDPOINTS)
def test_statistics_require_authentication(http_client: TestClient, endpoint: str):
    response = http_client.get(endpoint, params=[("account_ids", 1)])
    assert response.status_code == 401


@pytest.mark.parametrize(argnames="endpoint", argvalues=STATISTICS_ENDPOINTS)
def test_statistics_require_at_least_one_account_id(http_client: TestClient, endpoint: str):
    register(http_client)
    response = http_client.get(endpoint)
    assert response.status_code == 422


@pytest.mark.parametrize(argnames="endpoint", argvalues=STATISTICS_ENDPOINTS)
def test_statistics_reject_account_owned_by_a_different_user(
    http_client: TestClient, session_factory: sessionmaker, endpoint: str
):
    register(http_client, user_name="owner")
    credential_id = create_credential(http_client).json()["id"]
    account_id = persist_account(session_factory=session_factory, credential_id=credential_id)

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

    response = http_client.get(endpoint, params=[("account_ids", account_id)])

    assert response.status_code == 404


@pytest.mark.parametrize(argnames="endpoint", argvalues=STATISTICS_ENDPOINTS)
def test_statistics_return_empty_list_without_matching_transactions(
    http_client: TestClient, session_factory: sessionmaker, endpoint: str
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    response = http_client.get(endpoint, params=[("account_ids", account_id)])
    assert response.status_code == 200
    # net-worth returns an object ({series, summary}); the others return a bare list.
    expected = {"series": [], "summary": None} if endpoint.endswith("/net-worth") else []
    assert response.json() == expected


def test_net_worth_range_breaks_down_change_per_account(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_snapshot(
        session_factory=session_factory,
        account_id=account_id,
        day=date(year=2026, month=5, day=19),
        balance=DEFAULT_BALANCE,
    )
    seed_snapshot(
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=5, day=20), balance=130.0
    )
    transaction_id = persist_transaction(
        session_factory, account_id=account_id, amount=DEFAULT_AMOUNT, date=date(year=2026, month=5, day=20)
    )

    response = http_client.get(
        "/api/statistics/net-worth/range",
        params=[("start", "2026-05-19"), ("end", "2026-05-20"), ("account_ids", account_id)],
    )

    assert response.status_code == 200
    assert response.json() == {
        "start": "2026-05-19",
        "end": "2026-05-20",
        "total_at_start": 100.0,
        "total_at_end": 130.0,
        "total_difference": 30.0,
        "accounts": [
            {
                "account_id": account_id,
                "balance_at_start": 100.0,
                "balance_at_end": 130.0,
                "difference": 30.0,
                "transactions": [
                    {
                        "id": transaction_id,
                        "account_id": account_id,
                        "amount": DEFAULT_AMOUNT,
                        "purpose": None,
                        "date": "2026-05-20",
                        "other_party": None,
                        "transaction_type": None,
                        "category": "UNKNOWN",
                        "note": None,
                        "pending": False,
                        "contract_id": None,
                        "refund_status": None,
                    }
                ],
            }
        ],
    }


def test_net_worth_range_rejects_foreign_account(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    register_and_login(http_client, user_name=INTRUDER_USER_NAME)

    response = http_client.get(
        "/api/statistics/net-worth/range",
        params=[("start", "2026-05-19"), ("end", "2026-05-20"), ("account_ids", account_id)],
    )

    assert response.status_code == 404
