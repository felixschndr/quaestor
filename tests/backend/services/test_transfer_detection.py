from datetime import date, timedelta

from source.backend.bank_handlers import BankProvider
from source.backend.models.account import Account
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_type import TransactionType
from source.backend.models.user import User
from source.backend.services import transfer_detection
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import (
    make_account,
    make_credential,
    make_transaction,
    make_user,
)

_BASE_DATE = date(year=2026, month=5, day=10)


def _create_two_accounts(session: Session, *, user_id: int) -> tuple[Account, Account]:
    credential_a = make_credential(session, user_id=user_id, bank=BankProvider.FINTS)
    credential_b = make_credential(session, user_id=user_id, bank=BankProvider.FINTS)
    account_a = make_account(session, credential_id=credential_a.id, name="A")
    account_b = make_account(session, credential_id=credential_b.id, name="B")
    return account_a, account_b


def test_detects_a_simple_transfer_and_links_them(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=_BASE_DATE + timedelta(days=2),
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        created = transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id)
        session.flush()

        assert created == 1
        assert out_transaction.transaction_type == TransactionType.TRANSFER_OUT
        assert in_transaction.transaction_type == TransactionType.TRANSFER_IN
        assert out_transaction.transfer_counterpart_id == in_transaction.id
        assert in_transaction.transfer_counterpart_id == out_transaction.id


def test_amount_tolerance(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        within = make_transaction(
            session, account_id=account_b.id, amount=49.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        make_transaction(
            session, account_id=account_b.id, amount=48.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        assert within.transaction_type == TransactionType.TRANSFER_IN


def test_no_match_when_time_difference_is_too_big(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=_BASE_DATE + timedelta(days=6),
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 0


def test_does_not_match_within_the_same_account(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        make_transaction(
            session, account_id=account_a.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 0


def test_does_not_match_across_different_users(session_factory: sessionmaker):
    with session_factory() as session:
        user_one = make_user(session, user_name="one")
        user_two = make_user(session, user_name="two")
        credential_one = make_credential(session, user_id=user_one.id, bank=BankProvider.FINTS)
        credential_two = make_credential(session, user_id=user_two.id, bank=BankProvider.FINTS)
        account_one = make_account(session, credential_id=credential_one.id, name="One")
        account_two = make_account(session, credential_id=credential_two.id, name="Two")
        make_transaction(
            session, account_id=account_one.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        make_transaction(
            session, account_id=account_two.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user_one.id) == 0


def test_ignores_non_whitelisted_transaction_types(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        # A securities sale crediting cash must not be mistaken for a transfer.
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.BUY
        )
        make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.SELL
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 0


def test_is_idempotent_across_reruns(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        session.flush()
        # Second run finds nothing new and leaves the existing pair untouched.
        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 0


def test_pairs_one_to_one_when_multiple_inflows_match(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        # Two equally-close inflows; exactly one must be paired, the other left untouched.
        first = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        second = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        paired = [t for t in (first, second) if t.transaction_type == TransactionType.TRANSFER_IN]
        unpaired = [t for t in (first, second) if t.transaction_type == TransactionType.INCOMING]
        assert len(paired) == 1
        assert len(unpaired) == 1
        assert unpaired[0].transfer_counterpart_id is None


def test_deleting_one_leg_clears_the_counterpart_link(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()
        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        session.flush()

        session.delete(out_transaction)
        session.flush()

        session.refresh(in_transaction)
        assert in_transaction.transfer_counterpart_id is None


def test_prefers_the_candidate_with_matching_purpose(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-50.0,
            date=_BASE_DATE,
            purpose="Rent",
            transaction_type=TransactionType.OUTGOING,
        )
        # Same amount and date; the one with the matching purpose should win the tie.
        other_purpose = make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=_BASE_DATE,
            purpose="Something else",
            transaction_type=TransactionType.INCOMING,
        )
        matching_purpose = make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=_BASE_DATE,
            purpose="Rent",
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        assert matching_purpose.transaction_type == TransactionType.TRANSFER_IN
        assert other_purpose.transaction_type == TransactionType.INCOMING


def test_stores_original_type_when_pairing(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.DEPOSIT
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        assert out_transaction.transfer_original_type == TransactionType.DEPOSIT
        assert in_transaction.transfer_original_type == TransactionType.INCOMING


def test_never_pairs_relink_blocked_transactions(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        blocked = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        blocked.transfer_relink_blocked = True
        make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 0
        assert blocked.transfer_counterpart_id is None


def test_deleting_a_user_with_a_linked_transfer_pair_does_not_deadlock(session_factory: sessionmaker):
    # Both legs of a transfer reference each other to no raise a CircularDependencyError
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=_BASE_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=_BASE_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()
        assert transfer_detection.detect_transfers_for_user(db_session=session, user_id=user.id) == 1
        session.flush()
        out_id, in_id = out_transaction.id, in_transaction.id

        session.delete(user)
        session.flush()

        assert session.get(entity=Transaction, ident=out_id) is None
        assert session.get(entity=Transaction, ident=in_id) is None
        assert session.get(entity=User, ident=user.id) is None
