import logging
from datetime import date

import pytest
from fastapi.testclient import TestClient
from source.backend.constants import API_PREFIX
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import (
    create_credential,
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
        {"category": "RESTAURANTS", "total": 30.0},
        {"category": "SUPERMARKET", "total": 20.0},
    ]


def test_categories_income_direction_returns_only_incoming(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_for_categories(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/statistics/categories", params=[("account_ids", account_id), ("direction", "INCOMING")]
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "SALARY", "total": 2500.0}]


def test_categories_logs_with_user_object(
    http_client: TestClient, session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    seed_for_categories(session_factory=session_factory, account_id=account_id)

    with caplog.at_level(logging.DEBUG, logger="services.statistics_service"):
        http_client.get("/api/statistics/categories", params=[("account_ids", account_id)])

    assert "category breakdown" in caplog.text
    assert "<User(" in caplog.text


def test_categories_respects_date_range(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(
            session,
            account_id=account_id,
            amount=-10.0,
            category=TransactionCategory.FUEL,
            date=date(year=2026, month=1, day=10),
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-20.0,
            category=TransactionCategory.FUEL,
            date=date(year=2026, month=3, day=10),
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("date_from", "2026-01-01"), ("date_to", "2026-01-31")],
    )

    assert response.json() == [{"category": "FUEL", "total": 10.0}]


def test_categories_rejects_invalid_direction(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    response = http_client.get(
        "/api/statistics/categories", params=[("account_ids", account_id), ("direction", "sideways")]
    )
    assert response.status_code == 422


def test_categories_include_transfers(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        out = make_transaction(session, account_id=account_id, amount=-100.0, category=TransactionCategory.SAVINGS)
        back = make_transaction(session, account_id=account_id, amount=100.0, category=TransactionCategory.SAVINGS)
        session.flush()
        out.transfer_counterpart_id = back.id
        back.transfer_counterpart_id = out.id
        make_transaction(
            session,
            account_id=account_id,
            amount=200.0,
            category=TransactionCategory.SALARY,
            transaction_type=TransactionType.TRANSFER_IN,
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories", params=[("account_ids", account_id), ("direction", "INCOMING")]
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "SALARY", "total": 200.0}, {"category": "SAVINGS", "total": 100.0}]


def test_categories_filter_by_transaction_type(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(
            session,
            account_id=account_id,
            amount=-10.0,
            category=TransactionCategory.FUEL,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-20.0,
            category=TransactionCategory.FEES,
            transaction_type=TransactionType.FEES,
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("transaction_types", "FEES")],
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "FEES", "total": 20.0}]


def test_categories_filter_by_multiple_transaction_types(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(
            session,
            account_id=account_id,
            amount=-10.0,
            category=TransactionCategory.FUEL,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-20.0,
            category=TransactionCategory.FEES,
            transaction_type=TransactionType.FEES,
        )
        make_transaction(
            session,
            account_id=account_id,
            amount=-5.0,
            category=TransactionCategory.GIFTS,
            transaction_type=TransactionType.BUY,
        )
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("transaction_types", "FEES"), ("transaction_types", "OUTGOING")],
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "FEES", "total": 20.0}, {"category": "FUEL", "total": 10.0}]


def test_categories_filter_by_linked_transfers_only(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        out = make_transaction(session, account_id=account_id, amount=-100.0, category=TransactionCategory.SAVINGS)
        back = make_transaction(session, account_id=account_id, amount=-100.0, category=TransactionCategory.RENT)
        session.flush()
        out.transfer_counterpart_id = back.id
        session.commit()

    linked = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("linked", "linked")],
    )
    unlinked = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("linked", "unlinked")],
    )

    assert linked.status_code == 200
    assert linked.json() == [{"category": "SAVINGS", "total": 100.0}]
    assert unlinked.json() == [{"category": "RENT", "total": 100.0}]


def test_categories_rejects_invalid_transaction_type(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("transaction_types", "NONSENSE")],
    )
    assert response.status_code == 422


def test_categories_filter_restricts_results(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=-10.0, category=TransactionCategory.FUEL)
        make_transaction(session, account_id=account_id, amount=-20.0, category=TransactionCategory.RENT)
        make_transaction(session, account_id=account_id, amount=-5.0, category=TransactionCategory.GIFTS)
        session.commit()

    response = http_client.get(
        "/api/statistics/categories",
        params=[("account_ids", account_id), ("categories", "FUEL"), ("categories", "RENT")],
    )

    assert response.status_code == 200
    assert response.json() == [{"category": "RENT", "total": 20.0}, {"category": "FUEL", "total": 10.0}]


def _seed_two_months(session_factory: sessionmaker, account_id: int) -> None:
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=2500.00, date=date(year=2026, month=1, day=31))
        make_transaction(session, account_id=account_id, amount=-12.50, date=date(year=2026, month=1, day=15))
        make_transaction(session, account_id=account_id, amount=-30.00, date=date(year=2026, month=2, day=5))
        make_transaction(
            session, account_id=account_id, amount=-77.0, date=date(year=2026, month=1, day=20), pending=True
        )
        session.commit()


def test_cashflow_splits_income_and_expenses_per_month(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_two_months(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/cashflow", params=[("account_ids", account_id)])

    assert response.status_code == 200
    assert response.json() == [
        {"month": "2026-01", "income": 2500.0, "expenses": 12.5},
        {"month": "2026-02", "income": 0.0, "expenses": 30.0},
    ]


def test_net_savings_computes_net_and_rate_per_month(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_two_months(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/net-savings", params=[("account_ids", account_id)])

    assert response.status_code == 200
    body = response.json()
    # 2026-01: net = 2500 - 12.50 = 2487.50; rate = 2487.50 / 2500 * 100 = 99.5%.
    assert body[0] == {"month": "2026-01", "net": 2487.5, "savings_rate": 99.5}
    # 2026-02: no income → net negative, savings_rate clamped to 0.0 (no divide-by-zero).
    assert body[1] == {"month": "2026-02", "net": -30.0, "savings_rate": 0.0}


def _seed_other_parties(session_factory: sessionmaker, account_id: int) -> None:
    with session_factory() as session:
        make_transaction(session, account_id=account_id, amount=-12.50, other_party="Rewe")
        make_transaction(session, account_id=account_id, amount=-7.50, other_party="Rewe")
        make_transaction(session, account_id=account_id, amount=-30.00, other_party="Edeka")
        make_transaction(session, account_id=account_id, amount=-5.00, other_party="Amazon")
        make_transaction(session, account_id=account_id, amount=1000.00, other_party="Employer")
        make_transaction(session, account_id=account_id, amount=-100.00, other_party=None)
        make_transaction(session, account_id=account_id, amount=-50.00, other_party="")
        session.commit()


def test_other_parties_orders_by_total_desc_and_limits(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_other_parties(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/other-parties", params=[("account_ids", account_id), ("limit", 2)])

    assert response.status_code == 200
    assert response.json() == [
        {"other_party": "Edeka", "total": 30.0},
        {"other_party": "Rewe", "total": 20.0},
    ]


def test_other_parties_excludes_null_and_empty_party(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_other_parties(session_factory=session_factory, account_id=account_id)

    response = http_client.get("/api/statistics/other-parties", params=[("account_ids", account_id)])

    parties = {row["other_party"] for row in response.json()}
    assert parties == {"Rewe", "Edeka", "Amazon"}
    assert "" not in parties


def test_other_parties_income_direction(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)
    _seed_other_parties(session_factory=session_factory, account_id=account_id)

    response = http_client.get(
        "/api/statistics/other-parties", params=[("account_ids", account_id), ("direction", "INCOMING")]
    )

    assert response.json() == [{"other_party": "Employer", "total": 1000.0}]


def test_statistics_span_multiple_accounts(http_client: TestClient, session_factory: sessionmaker):
    register(http_client)
    credential_id = create_credential(http_client).json()["id"]
    giro = persist_account(session_factory=session_factory, credential_id=credential_id, name="Giro")
    spar = persist_account(session_factory=session_factory, credential_id=credential_id, name="Sparkonto")
    with session_factory() as session:
        make_transaction(session, account_id=giro, amount=-10.0, category=TransactionCategory.FUEL)
        make_transaction(session, account_id=spar, amount=-15.0, category=TransactionCategory.FUEL)
        session.commit()

    response = http_client.get("/api/statistics/categories", params=[("account_ids", giro), ("account_ids", spar)])

    assert response.json() == [{"category": "FUEL", "total": 25.0}]


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
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=1, day=3), balance=100.0
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

    register_and_login(http_client, user_name="intruder")

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
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=5, day=19), balance=100.0
    )
    seed_snapshot(
        session_factory=session_factory, account_id=account_id, day=date(year=2026, month=5, day=20), balance=130.0
    )
    transaction_id = persist_transaction(
        session_factory, account_id=account_id, amount=30.0, date=date(year=2026, month=5, day=20)
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
                        "amount": 30.0,
                        "purpose": None,
                        "date": "2026-05-20",
                        "other_party": None,
                        "transaction_type": None,
                        "category": "UNKNOWN",
                        "note": None,
                        "transfer_counterpart_id": None,
                        "pending": False,
                    }
                ],
            }
        ],
    }


def test_net_worth_range_rejects_foreign_account(http_client: TestClient, session_factory: sessionmaker):
    account_id = setup_account(http_client=http_client, session_factory=session_factory)

    register_and_login(http_client, user_name="intruder")

    response = http_client.get(
        "/api/statistics/net-worth/range",
        params=[("start", "2026-05-19"), ("end", "2026-05-20"), ("account_ids", account_id)],
    )

    assert response.status_code == 404
