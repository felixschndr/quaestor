import asyncio
from datetime import timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.models.contracts.contract import Contract
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.contracts.contract_frequency import ContractFrequency
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.contracts import contract_detection_service
from source.backend.services.contracts.contract_detection_service import (
    run_startup_detection as real_run_startup_detection,
)
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    NETFLIX,
    OLDER_DATE,
    SECOND_USER_NAME,
    USER_NAME,
    assert_log_contains,
    make_account,
    make_account_with_new_user,
    make_contract,
    make_credential,
    make_transaction,
)


def _seed(
    session: Session,
    account_id: int,
    other_party: str,
    amount: float,
    day_offsets: list[int],
    purpose: str | None = None,
) -> None:
    for offset in day_offsets:
        make_transaction(
            session,
            account_id=account_id,
            amount=amount,
            other_party=other_party,
            purpose=purpose,
            date=OLDER_DATE + timedelta(days=offset),
            transaction_type=TransactionType.OUTGOING if amount < 0 else TransactionType.INCOMING,
        )


def test_detects_monthly_series_as_contract(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party=NETFLIX, amount=-DEFAULT_AMOUNT, day_offsets=[0, 30, 60, 90])
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert len(detected) == 1
        contract = session.query(Contract).one()
        assert contract.name == NETFLIX
        assert contract.frequency == ContractFrequency.MONTHLY
        assert len(contract.members()) == 4
        assert contract.median_amount == -DEFAULT_AMOUNT
        assert contract.expected_next_date == OLDER_DATE + timedelta(days=120)
        assert_log_contains(
            caplog, messages=["Detected new <Contract(", "1 recurring and 1 newly created contract(s) detected"]
        )


def test_detects_biweekly_series(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(
            session,
            account_id=account.id,
            other_party="Cleaning Service",
            amount=-DEFAULT_AMOUNT,
            day_offsets=[0, 14, 28],
        )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert session.query(Contract).one().frequency == ContractFrequency.BIWEEKLY


def test_backfill_detects_contracts_for_every_user(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(target=contract_detection_service, name="SessionLocal", value=session_factory)
    user_names = [USER_NAME, SECOND_USER_NAME]
    for user_name in user_names:
        with session_factory() as session:
            account = make_account_with_new_user(session, user_name=user_name)
            _seed(
                session,
                account_id=account.id,
                other_party=NETFLIX,
                amount=-DEFAULT_AMOUNT,
                day_offsets=[0, 30, 60, 90],
            )
            session.commit()

    contract_detection_service.detect_contracts_for_all_users()

    assert_log_contains(caplog, message="Running contract detection for 2 user(s)")
    with session_factory() as session:
        assert session.query(Contract).count() == len(user_names)


_APPLE_PAYPAL_PURPOSE = "1049068044726/PP.1922.PP/. Apple Services, Ihr Einkauf bei Apple Services"


def test_paypal_routed_subscription_only_forms_a_contract_on_the_paypal_account(session_factory: sessionmaker):
    with session_factory() as session:
        bank_account = make_account_with_new_user(session, bank=BankProvider.FINTS)
        paypal_credential = make_credential(
            session,
            user_id=bank_account.credential.user_id,
            bank=BankProvider.ENABLE_BANKING,
            credentials={"aspsp_name": "PayPal"},
        )
        paypal_account = make_account(session, credential_id=paypal_credential.id, name="PayPal")
        for offset in [0, 30, 60, 90]:
            make_transaction(
                session,
                account_id=bank_account.id,
                amount=-DEFAULT_AMOUNT,
                other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
                purpose=_APPLE_PAYPAL_PURPOSE,
                date=OLDER_DATE + timedelta(days=offset),
                transaction_type=TransactionType.OUTGOING,
            )
            make_transaction(
                session,
                account_id=paypal_account.id,
                amount=-DEFAULT_AMOUNT,
                other_party="Apple Services",
                date=OLDER_DATE + timedelta(days=offset - 3),
                transaction_type=TransactionType.OUTGOING,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=bank_account)
        contract_detection_service.detect_contracts_for_account(db_session=session, account=paypal_account)

        contract = session.query(Contract).one()
        assert contract.account_id == paypal_account.id
        assert contract.fingerprint == "party:apple services:out"


def test_paypal_routed_subscription_forms_a_bank_contract_without_a_paypal_account(session_factory: sessionmaker):
    with session_factory() as session:
        bank_account = make_account_with_new_user(session, bank=BankProvider.FINTS)
        for offset in [0, 30, 60, 90]:
            make_transaction(
                session,
                account_id=bank_account.id,
                amount=-DEFAULT_AMOUNT,
                other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
                purpose=_APPLE_PAYPAL_PURPOSE,
                date=OLDER_DATE + timedelta(days=offset),
                transaction_type=TransactionType.OUTGOING,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=bank_account)

        contract = session.query(Contract).one()
        assert contract.fingerprint == "paypal:apple services:out"


def test_blacklisted_other_party_does_not_form_a_contract(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(
            session,
            account_id=account.id,
            other_party="EDEKA Markt Mueller",
            amount=-DEFAULT_AMOUNT,
            day_offsets=[0, 30, 60],
        )
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert detected == []
        assert session.query(Contract).count() == 0


def test_too_few_occurrences_do_not_form_a_contract(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party=NETFLIX, amount=-DEFAULT_AMOUNT, day_offsets=[0, 30])
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert detected == []
        assert session.query(Contract).count() == 0


def test_amount_outlier_stays_in_series_and_is_flagged(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        for offset, amount in [(0, 2000.0), (30, 2000.0), (60, 3000.0), (90, 2000.0)]:
            make_transaction(
                session,
                account_id=account.id,
                amount=amount,
                other_party="ACME Corp",
                date=OLDER_DATE + timedelta(days=offset),
                transaction_type=TransactionType.INCOMING,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        contract = session.query(Contract).one()
        assert len(contract.members()) == 4
        assert contract.median_amount == 2000.0
        outliers = [transaction for transaction in contract.members() if contract.is_outlier(transaction)]
        assert len(outliers) == 1
        assert outliers[0].amount == 3000.0


def test_utility_bill_that_more_than_doubles_stays_a_flagged_member(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        for offset, amount in [(0, -91.0), (30, -91.0), (60, -91.0), (90, -91.0), (120, -193.87)]:
            make_transaction(
                session,
                account_id=account.id,
                amount=amount,
                other_party="Vattenfall Europe Sales",
                date=OLDER_DATE + timedelta(days=offset),
                transaction_type=TransactionType.OUTGOING,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        contract = session.query(Contract).one()
        assert len(contract.members()) == 5
        outliers = [transaction for transaction in contract.members() if contract.is_outlier(transaction)]
        assert len(outliers) == 1
        assert outliers[0].amount == -193.87


def test_amount_far_from_median_is_not_assigned_to_the_contract(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        # A monthly salary with a couple of small extra payments (reimbursements/bonuses) from the same employer.
        for offset, amount in [(0, 2000.0), (30, 2050.0), (45, 100.0), (60, 1950.0), (75, 120.0), (90, 2100.0)]:
            make_transaction(
                session,
                account_id=account.id,
                amount=amount,
                other_party="Employer GmbH",
                date=OLDER_DATE + timedelta(days=offset),
                transaction_type=TransactionType.INCOMING,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        contract = session.query(Contract).one()
        member_amounts = sorted(transaction.amount for transaction in contract.members())
        assert member_amounts == [1950.0, 2000.0, 2050.0, 2100.0]


def test_sustained_amount_change_becomes_the_new_normal(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        # Six months at the old price, then a permanent increase for the last five months.
        amounts = [-39.90] * 6 + [-46.90] * 5
        for index, amount in enumerate(amounts):
            make_transaction(
                session,
                account_id=account.id,
                amount=amount,
                other_party="Gym",
                date=OLDER_DATE + timedelta(days=30 * index),
                transaction_type=TransactionType.OUTGOING,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        contract = session.query(Contract).one()
        assert len(contract.members()) == 11
        assert contract.median_amount == -46.90
        recent = [transaction for transaction in contract.members() if transaction.amount == -46.90]
        assert all(not contract.is_outlier(transaction) for transaction in recent)


def test_paypal_transactions_are_split_into_one_contract_per_merchant(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        for merchant in ("Apple Services", "Spotify AB"):
            _seed(
                session,
                account_id=account.id,
                other_party="PayPal Europe",
                amount=-DEFAULT_AMOUNT,
                day_offsets=[0, 30, 60],
                purpose=f"123/PP.1.PP/. {merchant}, Ihr Einkauf bei {merchant}",
            )
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert len(detected) == 2
        assert {contract.name for contract in session.query(Contract).all()} == {"Apple Services", "Spotify AB"}


def test_detection_is_idempotent(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party=NETFLIX, amount=-DEFAULT_AMOUNT, day_offsets=[0, 30, 60, 90])
        session.commit()

        first_run = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)
        second_run = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert len(first_run) == 1
        assert second_run == []
        assert session.query(Contract).count() == 1
        assert len(session.query(Contract).one().members()) == 4


def test_contract_category_is_applied_to_newly_detected_members(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        contract = make_contract(
            session, account_id=account.id, name=NETFLIX, category=TransactionCategory.ENTERTAINMENT
        )
        contract.fingerprint = "party:netflix:out"
        for offset in (0, 30, 60, 90):
            make_transaction(
                session,
                account_id=account.id,
                amount=-DEFAULT_AMOUNT,
                other_party=NETFLIX,
                date=OLDER_DATE + timedelta(days=offset),
                transaction_type=TransactionType.OUTGOING,
                category=TransactionCategory.SUBSCRIPTIONS,
            )
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        session.refresh(contract)
        members = contract.members()
        assert len(members) == 4
        assert {member.category for member in members} == {TransactionCategory.ENTERTAINMENT}


def test_excluded_transaction_is_not_re_added(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party=NETFLIX, amount=-DEFAULT_AMOUNT, day_offsets=[0, 30, 60, 90])
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)
        contract = session.query(Contract).one()
        excluded = contract.members()[0]
        excluded.contract_assignment = ContractAssignment.EXCLUDED
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        session.refresh(excluded)
        assert excluded.contract_assignment == ContractAssignment.EXCLUDED
        assert excluded.id not in {member.id for member in contract.members()}


def test_startup_detection_logs_and_swallows_a_crash(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    monkeypatch.setattr(
        target=contract_detection_service,
        name="detect_contracts_for_all_users",
        value=Mock(side_effect=RuntimeError("detection failed")),
    )

    asyncio.run(real_run_startup_detection())

    assert_log_contains(caplog, message="Startup contract detection backfill crashed")


def test_new_matching_payments_reactivate_an_archived_contract(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party=NETFLIX, amount=-DEFAULT_AMOUNT, day_offsets=[0, 30, 60, 90])
        session.commit()
        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        contract = session.query(Contract).one()
        contract.is_archived = True
        session.commit()

        _seed(session, account_id=account.id, other_party=NETFLIX, amount=-DEFAULT_AMOUNT, day_offsets=[120, 150, 180])
        session.commit()
        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        session.refresh(contract)
        assert not contract.is_archived
