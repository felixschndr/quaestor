from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.models.accounts.account import Account
from source.backend.models.auth.user import User
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.transactions import transfer_detection
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    RECENT_DATE,
    SECOND_ACCOUNT_IBAN,
    assert_log_contains,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)


def _create_two_accounts(session: Session, user_id: int) -> tuple[Account, Account]:
    credential_a = make_credential(session, user_id=user_id, bank=BankProvider.FINTS)
    credential_b = make_credential(session, user_id=user_id, bank=BankProvider.FINTS)
    account_a = make_account(session, credential_id=credential_a.id, name=ACCOUNT_IBAN)
    account_b = make_account(session, credential_id=credential_b.id, name=SECOND_ACCOUNT_IBAN)
    return account_a, account_b


def test_detects_a_simple_transfer_and_links_them(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=RECENT_DATE + timedelta(days=2),
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        created = transfer_detection.detect_transfers_for_user(db_session=session, user=user)
        session.flush()

        assert created == 1
        assert_log_contains(caplog, message="Transfer detection for")
        assert out_transaction.transaction_type == TransactionType.TRANSFER_OUT
        assert in_transaction.transaction_type == TransactionType.TRANSFER_IN
        assert out_transaction.transfer_counterpart_id == in_transaction.id
        assert in_transaction.transfer_counterpart_id == out_transaction.id


def test_requires_an_exact_amount_match(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        # Off by one: a similarly-sized but unrelated booking must not be swept into a bogus transfer pair.
        near_miss = make_transaction(
            session, account_id=account_b.id, amount=49.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        exact = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert exact.transaction_type == TransactionType.TRANSFER_IN
        assert near_miss.transaction_type == TransactionType.INCOMING


def test_no_match_when_time_difference_is_too_big(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=RECENT_DATE + timedelta(days=6),
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0


def test_same_account_pair_is_linked_as_reimbursement(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session, account_id=account_a.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert out_transaction.transfer_counterpart_id == in_transaction.id
        assert in_transaction.transfer_counterpart_id == out_transaction.id
        assert out_transaction.category != TransactionCategory.REIMBURSEMENT
        assert in_transaction.category == TransactionCategory.REIMBURSEMENT


def test_prefers_a_different_account_over_the_same_account(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        same_account = make_transaction(
            session, account_id=account_a.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        other_account = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert out_transaction.transfer_counterpart_id == other_account.id
        assert same_account.transfer_counterpart_id is None


def test_does_not_match_across_different_users(session_factory: sessionmaker):
    with session_factory() as session:
        user_one = make_user(session, user_name="one")
        user_two = make_user(session, user_name="two")
        credential_one = make_credential(session, user_id=user_one.id, bank=BankProvider.FINTS)
        credential_two = make_credential(session, user_id=user_two.id, bank=BankProvider.FINTS)
        account_one = make_account(session, credential_id=credential_one.id, name=ACCOUNT_IBAN)
        account_two = make_account(session, credential_id=credential_two.id, name=SECOND_ACCOUNT_IBAN)
        make_transaction(
            session,
            account_id=account_one.id,
            amount=-50.0,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session, account_id=account_two.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user_one) == 0


def test_ignores_non_whitelisted_transaction_types(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        # A securities sale crediting cash must not be mistaken for a transfer.
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.BUY
        )
        make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.SELL
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0


def test_is_idempotent_across_reruns(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        session.flush()
        # Second run finds nothing new and leaves the existing pair untouched.
        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0


def test_pairs_one_to_one_when_multiple_inflows_match(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        # Two equally-close inflows; exactly one must be paired, the other left untouched.
        first = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        second = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
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
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()
        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
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
            date=RECENT_DATE,
            purpose="Rent",
            transaction_type=TransactionType.OUTGOING,
        )
        # Same amount and date; the one with the matching purpose should win the tie.
        other_purpose = make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=RECENT_DATE,
            purpose="Something else",
            transaction_type=TransactionType.INCOMING,
        )
        matching_purpose = make_transaction(
            session,
            account_id=account_b.id,
            amount=50.0,
            date=RECENT_DATE,
            purpose="Rent",
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert matching_purpose.transaction_type == TransactionType.TRANSFER_IN
        assert other_purpose.transaction_type == TransactionType.INCOMING


def test_stores_original_type_when_pairing(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.DEPOSIT
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert out_transaction.transfer_original_type == TransactionType.DEPOSIT
        assert in_transaction.transfer_original_type == TransactionType.INCOMING


def test_never_pairs_relink_blocked_transactions(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        blocked = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        blocked.transfer_relink_blocked = True
        make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0
        assert blocked.transfer_counterpart_id is None


def test_deleting_a_user_with_a_linked_transfer_pair_does_not_deadlock(session_factory: sessionmaker):
    # Both legs of a transfer reference each other to no raise a CircularDependencyError
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-50.0, date=RECENT_DATE, transaction_type=TransactionType.OUTGOING
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=50.0, date=RECENT_DATE, transaction_type=TransactionType.INCOMING
        )
        session.flush()
        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        session.flush()
        out_id, in_id = out_transaction.id, in_transaction.id

        session.delete(user)
        session.flush()

        assert session.get(entity=Transaction, ident=out_id) is None
        assert session.get(entity=Transaction, ident=in_id) is None
        assert session.get(entity=User, ident=user.id) is None


def _create_bank_and_paypal_accounts(session: Session, user_id: int) -> tuple[Account, Account]:
    bank_credential = make_credential(session, user_id=user_id, bank=BankProvider.FINTS)
    paypal_credential = make_credential(
        session, user_id=user_id, bank=BankProvider.ENABLE_BANKING, credentials={"aspsp_name": "PayPal"}
    )
    bank_account = make_account(session, credential_id=bank_credential.id, name=ACCOUNT_IBAN)
    paypal_account = make_account(session, credential_id=paypal_credential.id, name=SECOND_ACCOUNT_IBAN)
    return bank_account, paypal_account


def test_links_same_signed_mirror_booking_on_an_intermediary_account(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        funding = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-21.99,
            date=RECENT_DATE + timedelta(days=1),
            other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
            purpose="123456/PP.1922.PP/. SpotifyAB, Ihr Einkauf bei Spotify AB",
            transaction_type=TransactionType.OUTGOING,
        )
        mirror = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-21.99,
            date=RECENT_DATE,
            other_party="Spotify AB",
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert funding.transaction_type == TransactionType.TRANSFER_OUT
        assert funding.transfer_original_type == TransactionType.OUTGOING
        assert mirror.transaction_type == TransactionType.OUTGOING
        assert funding.transfer_counterpart_id == mirror.id
        assert mirror.transfer_counterpart_id == funding.id


def test_mirror_matching_prefers_the_funding_leg_naming_the_same_merchant(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        other_purchase = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-13.0,
            date=RECENT_DATE,
            other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
            purpose="123456/PP.1922.PP/. Ihr Einkauf bei Steam",
            transaction_type=TransactionType.OUTGOING,
        )
        matching_purchase = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-13.0,
            date=RECENT_DATE,
            other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
            purpose="123456/PP.1922.PP/. Ihr Einkauf bei Restaurant Rama",
            transaction_type=TransactionType.OUTGOING,
        )
        mirror = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-13.0,
            date=RECENT_DATE,
            other_party="Restaurant Rama",
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert mirror.transfer_counterpart_id == matching_purchase.id
        assert other_purchase.transfer_counterpart_id is None
        assert other_purchase.transaction_type == TransactionType.OUTGOING


def test_never_links_mirror_bookings_without_an_intermediary_counterparty(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        unrelated = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-9.99,
            date=RECENT_DATE,
            other_party="Netflix International B.V.",
            transaction_type=TransactionType.OUTGOING,
        )
        mirror = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-9.99,
            date=RECENT_DATE,
            other_party="Some Merchant",
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0
        assert unrelated.transfer_counterpart_id is None
        assert mirror.transfer_counterpart_id is None


def test_opposite_signed_intermediary_pairs_stay_regular_transfers(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        withdrawal = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-100.0,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        deposit = make_transaction(
            session,
            account_id=bank_account.id,
            amount=100.0,
            date=RECENT_DATE,
            other_party="PAYPAL",
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert withdrawal.transaction_type == TransactionType.TRANSFER_OUT
        assert deposit.transaction_type == TransactionType.TRANSFER_IN
