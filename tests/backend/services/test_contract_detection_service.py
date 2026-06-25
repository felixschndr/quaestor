from datetime import timedelta

from source.backend.models.contract import Contract
from source.backend.models.contract_assignment import ContractAssignment
from source.backend.models.contract_frequency import ContractFrequency
from source.backend.models.transaction_type import TransactionType
from source.backend.services import contract_detection_service
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import (
    OLDER_DATE,
    make_account_with_new_user,
    make_transaction,
)


def _seed(
    session: Session,
    *,
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


def test_detects_monthly_series_as_contract(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party="Netflix", amount=-12.99, day_offsets=[0, 30, 60, 90])
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert detected == 1
        contract = session.query(Contract).one()
        assert contract.name == "Netflix"
        assert contract.frequency == ContractFrequency.MONTHLY
        assert len(contract.members()) == 4
        assert contract.median_amount == -12.99
        assert contract.expected_next_date == OLDER_DATE + timedelta(days=120)


def test_detects_biweekly_series(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party="Cleaning Service", amount=-20.0, day_offsets=[0, 14, 28])
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert session.query(Contract).one().frequency == ContractFrequency.BIWEEKLY


def test_too_few_occurrences_do_not_form_a_contract(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party="Netflix", amount=-12.99, day_offsets=[0, 30])
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert detected == 0
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


def test_paypal_transactions_are_split_into_one_contract_per_merchant(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        for merchant in ("Apple Services", "Spotify AB"):
            _seed(
                session,
                account_id=account.id,
                other_party="PayPal Europe",
                amount=-9.99,
                day_offsets=[0, 30, 60],
                purpose=f"123/PP.1.PP/. {merchant}, Ihr Einkauf bei {merchant}",
            )
        session.commit()

        detected = contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert detected == 2
        assert {contract.name for contract in session.query(Contract).all()} == {"Apple Services", "Spotify AB"}


def test_detection_is_idempotent(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party="Netflix", amount=-12.99, day_offsets=[0, 30, 60, 90])
        session.commit()

        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)
        contract_detection_service.detect_contracts_for_account(db_session=session, account=account)

        assert session.query(Contract).count() == 1
        assert len(session.query(Contract).one().members()) == 4


def test_excluded_transaction_is_not_re_added(session_factory: sessionmaker):
    with session_factory() as session:
        account = make_account_with_new_user(session)
        _seed(session, account_id=account.id, other_party="Netflix", amount=-12.99, day_offsets=[0, 30, 60, 90])
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
