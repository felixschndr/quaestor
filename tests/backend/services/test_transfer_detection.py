from datetime import timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from source.backend.bank_handlers import BankProvider
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_balance_snapshot import AccountBalanceSnapshot, BalanceSnapshotSource
from source.backend.models.auth.user import User
from source.backend.models.transactions.flow_link_source import FlowLinkSource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.transactions import transfer_detection
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    DEFAULT_AMOUNT,
    ETF_NAME,
    LARGE_AMOUNT,
    NETFLIX,
    RECENT_DATE,
    SECOND_ACCOUNT_IBAN,
    SECOND_AMOUNT,
    UNKNOWN_TRANSACTION_OTHER_PARTY,
    assert_log_contains,
    link_transactions_as_flow,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)


def _assert_linked(transactions: list[Transaction]) -> None:
    flow_ids = {transaction.flow_id for transaction in transactions}
    assert None not in flow_ids, "every transaction should belong to a flow"
    assert len(flow_ids) == 1, "all transactions should share the same flow"
    assert all(t.flow_link_source == FlowLinkSource.DETECTED for t in transactions), "auto-links are DETECTED"


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
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        in_transaction = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
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
        _assert_linked([out_transaction, in_transaction])


def test_requires_an_exact_amount_match(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        # Off by one: a similarly-sized but unrelated booking must not be swept into a bogus transfer pair.
        near_miss = make_transaction(
            session,
            account_id=account_b.id,
            amount=SECOND_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        exact = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
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
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=4),
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0


def test_same_account_pair_is_linked_as_reimbursement(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        in_transaction = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        _assert_linked([out_transaction, in_transaction])
        assert out_transaction.category != TransactionCategory.REIMBURSEMENT
        assert in_transaction.category == TransactionCategory.REIMBURSEMENT


def test_prefers_a_different_account_over_the_same_account(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        same_account = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        other_account = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        _assert_linked([out_transaction, other_account])
        assert same_account.flow_id is None


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
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_two.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user_one) == 0


def test_ignores_non_whitelisted_transaction_types(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        # A securities sale crediting cash must not be mistaken for a transfer.
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.BUY,
        )
        make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.SELL,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0


def test_is_idempotent_across_reruns(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
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
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        # Two equally-close inflows; exactly one must be paired, the other left untouched.
        first = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        second = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        paired = [t for t in (first, second) if t.transaction_type == TransactionType.TRANSFER_IN]
        unpaired = [t for t in (first, second) if t.transaction_type == TransactionType.INCOMING]
        assert len(paired) == 1
        assert len(unpaired) == 1
        assert unpaired[0].flow_id is None


def test_deleting_one_leg_dissolves_a_two_member_flow(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        in_transaction = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()
        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        session.flush()

        session.delete(out_transaction)
        session.flush()

        session.refresh(in_transaction)
        assert in_transaction.flow_id is None
        assert in_transaction.transaction_type == TransactionType.INCOMING


def test_deleting_a_flow_restores_member_types(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session, account_id=account_a.id, amount=-DEFAULT_AMOUNT, transaction_type=TransactionType.TRANSFER_OUT
        )
        in_transaction = make_transaction(
            session, account_id=account_b.id, amount=DEFAULT_AMOUNT, transaction_type=TransactionType.TRANSFER_IN
        )
        out_transaction.transfer_original_type = TransactionType.REMOVAL
        in_transaction.transfer_original_type = TransactionType.INCOMING
        flow = link_transactions_as_flow(db_session=session, transactions=[out_transaction, in_transaction])
        session.flush()

        session.delete(flow)
        session.flush()

        for transaction in (out_transaction, in_transaction):
            session.refresh(transaction)
            assert transaction.flow_id is None
            assert transaction.flow_link_source is None
            assert transaction.transfer_original_type is None
        assert out_transaction.transaction_type == TransactionType.REMOVAL
        assert in_transaction.transaction_type == TransactionType.INCOMING


def test_prefers_the_candidate_with_matching_purpose(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            purpose="Rent",
            transaction_type=TransactionType.OUTGOING,
        )
        # Same amount and date; the one with the matching purpose should win the tie.
        other_purpose = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            purpose="Something else",
            transaction_type=TransactionType.INCOMING,
        )
        matching_purpose = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
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
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.DEPOSIT,
        )
        in_transaction = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
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
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        blocked.transfer_relink_blocked = True
        make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0
        assert blocked.flow_id is None


def test_deleting_a_user_with_a_linked_transfer_pair_does_not_deadlock(session_factory: sessionmaker):
    # Both legs of a transfer reference each other to no raise a CircularDependencyError
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_transaction = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        in_transaction = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
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
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=1),
            other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
            purpose="123456/PP.1922.PP/. SpotifyAB, Ihr Einkauf bei Spotify AB",
            transaction_type=TransactionType.OUTGOING,
        )
        mirror = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party="Spotify AB",
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert funding.transaction_type == TransactionType.TRANSFER_OUT
        assert funding.transfer_original_type == TransactionType.OUTGOING
        assert mirror.transaction_type == TransactionType.OUTGOING
        _assert_linked([funding, mirror])


def test_mirror_matching_prefers_the_funding_leg_naming_the_same_merchant(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        other_purchase = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
            purpose="123456/PP.1922.PP/. Ihr Einkauf bei Steam",
            transaction_type=TransactionType.OUTGOING,
        )
        matching_purchase = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party="PayPal Europe S.a.r.l. et Cie S.C.A",
            purpose="123456/PP.1922.PP/. Ihr Einkauf bei Restaurant Rama",
            transaction_type=TransactionType.OUTGOING,
        )
        mirror = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party="Restaurant Rama",
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        _assert_linked([mirror, matching_purchase])
        assert other_purchase.flow_id is None
        assert other_purchase.transaction_type == TransactionType.OUTGOING


def test_never_links_mirror_bookings_without_an_intermediary_counterparty(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        unrelated = make_transaction(
            session,
            account_id=bank_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.OUTGOING,
        )
        mirror = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party="Some Merchant",
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 0
        assert unrelated.flow_id is None
        assert mirror.flow_id is None


def test_opposite_signed_intermediary_pairs_stay_regular_transfers(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        bank_account, paypal_account = _create_bank_and_paypal_accounts(session, user_id=user.id)
        withdrawal = make_transaction(
            session,
            account_id=paypal_account.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        )
        deposit = make_transaction(
            session,
            account_id=bank_account.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party="PAYPAL",
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        assert transfer_detection.detect_transfers_for_user(db_session=session, user=user) == 1
        assert withdrawal.transaction_type == TransactionType.TRANSFER_OUT
        assert deposit.transaction_type == TransactionType.TRANSFER_IN


def _existing_flow_leaving(session: Session, account: Account, amount: float) -> None:
    # A two-member DETECTED flow whose open end is a `-amount` outflow leaving `account`.
    incoming = make_transaction(
        session, account_id=account.id, amount=amount, date=RECENT_DATE, transaction_type=TransactionType.TRANSFER_IN
    )
    outgoing = make_transaction(
        session, account_id=account.id, amount=-amount, date=RECENT_DATE, transaction_type=TransactionType.TRANSFER_OUT
    )
    link_transactions_as_flow(db_session=session, transactions=[incoming, outgoing])


def test_chains_a_new_leg_onto_an_existing_flows_open_end(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        _existing_flow_leaving(session, account=account_a, amount=DEFAULT_AMOUNT)
        arrival = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=1),
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert_log_contains(caplog, message="chained into existing flows")
        assert arrival.flow_id is not None
        assert arrival.transaction_type == TransactionType.TRANSFER_IN
        assert arrival.transfer_original_type == TransactionType.INCOMING
        assert arrival.flow_link_source == FlowLinkSource.DETECTED


def test_does_not_chain_when_two_flows_are_in_reach(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        credential_c = make_credential(session, user_id=user.id, bank=BankProvider.FINTS)
        account_c = make_account(session, credential_id=credential_c.id, name="Third IBAN")
        _existing_flow_leaving(session, account=account_a, amount=DEFAULT_AMOUNT)
        _existing_flow_leaving(session, account=account_c, amount=DEFAULT_AMOUNT)
        arrival = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert arrival.flow_id is None


def test_never_chains_onto_a_manual_flow(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        incoming = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.TRANSFER_IN,
        )
        outgoing = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.TRANSFER_OUT,
        )
        link_transactions_as_flow(db_session=session, transactions=[incoming, outgoing])
        incoming.flow_link_source = FlowLinkSource.MANUAL
        outgoing.flow_link_source = FlowLinkSource.MANUAL
        arrival = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert arrival.flow_id is None


def test_does_not_chain_a_same_account_leg(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        _existing_flow_leaving(session, account=account_a, amount=DEFAULT_AMOUNT)
        refund = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert refund.flow_id is None


def test_links_a_partial_refund_to_its_payment_by_counterparty(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        payment = make_transaction(
            session,
            account_id=account_a.id,
            amount=-LARGE_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.OUTGOING,
        )
        refund = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=20),
            other_party=NETFLIX,
            transaction_type=TransactionType.INCOMING,
            category=TransactionCategory.REIMBURSEMENT,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        _assert_linked([payment, refund])
        assert payment.transaction_type == TransactionType.TRANSFER_OUT
        assert refund.transaction_type == TransactionType.TRANSFER_IN
        assert refund.category == TransactionCategory.REIMBURSEMENT


def test_does_not_link_a_refund_when_two_payments_to_the_same_party_are_open(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-LARGE_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.OUTGOING,
        )
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-LARGE_AMOUNT,
            date=RECENT_DATE + timedelta(days=1),
            other_party=NETFLIX,
            transaction_type=TransactionType.OUTGOING,
        )
        refund = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=20),
            other_party=NETFLIX,
            transaction_type=TransactionType.INCOMING,
            category=TransactionCategory.REIMBURSEMENT,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert refund.flow_id is None


def test_does_not_link_a_refund_older_than_the_window(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        make_transaction(
            session,
            account_id=account_a.id,
            amount=-LARGE_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.OUTGOING,
        )
        refund = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=40),
            other_party=NETFLIX,
            transaction_type=TransactionType.INCOMING,
            category=TransactionCategory.REIMBURSEMENT,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert refund.flow_id is None


def test_chains_a_same_account_retry_naming_the_same_counterparty(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        outgoing = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.TRANSFER_OUT,
        )
        returned = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.TRANSFER_IN,
        )
        link_transactions_as_flow(db_session=session, transactions=[outgoing, returned])
        retry = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=1),
            other_party=NETFLIX,
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert retry.flow_id == outgoing.flow_id
        assert retry.transaction_type == TransactionType.TRANSFER_OUT
        assert retry.transfer_original_type == TransactionType.OUTGOING


def test_does_not_chain_a_same_account_leg_with_a_different_counterparty(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        account_a, _ = _create_two_accounts(session, user_id=user.id)
        outgoing = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.TRANSFER_OUT,
        )
        returned = make_transaction(
            session,
            account_id=account_a.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            other_party=NETFLIX,
            transaction_type=TransactionType.TRANSFER_IN,
        )
        link_transactions_as_flow(db_session=session, transactions=[outgoing, returned])
        unrelated = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=1),
            other_party=UNKNOWN_TRANSACTION_OTHER_PARTY,
            transaction_type=TransactionType.OUTGOING,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert unrelated.flow_id is None


def _make_broker_setup(session: Session, user: User) -> tuple[object, Account, Account, object]:
    # A Trade-Republic-style broker credential with a cash account and a market-valued depot account, plus an
    # existing DETECTED flow that already holds the +5000 cash deposit (as after Phase 2 chained it).
    broker = make_credential(session, user_id=user.id, bank=BankProvider.TRADE_REPUBLIC)
    cash = make_account(session, credential_id=broker.id, name="Cash")
    depot = make_account(session, credential_id=broker.id, name=ETF_NAME)
    session.add(
        AccountBalanceSnapshot(
            account_id=depot.id, date=RECENT_DATE, balance=1.0, source=BalanceSnapshotSource.MARKET_VALUED
        )
    )
    personal = make_account(
        session, credential_id=make_credential(session, user_id=user.id, bank=BankProvider.FINTS).id
    )
    outgoing = make_transaction(
        session,
        account_id=personal.id,
        amount=-DEFAULT_AMOUNT,
        date=RECENT_DATE,
        transaction_type=TransactionType.TRANSFER_OUT,
    )
    deposit = make_transaction(
        session,
        account_id=cash.id,
        amount=DEFAULT_AMOUNT,
        date=RECENT_DATE,
        transaction_type=TransactionType.TRANSFER_IN,
    )
    flow = link_transactions_as_flow(db_session=session, transactions=[outgoing, deposit])
    return broker, cash, depot, flow


def test_chains_a_depot_buy_into_the_flow_keeping_its_buy_type(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        _, _, depot, flow = _make_broker_setup(session=session, user=user)
        depot_buy = make_transaction(
            session,
            account_id=depot.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=6),
            transaction_type=TransactionType.BUY,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert depot_buy.flow_id == flow.id
        assert depot_buy.flow_link_source == FlowLinkSource.DETECTED
        assert depot_buy.transaction_type == TransactionType.BUY
        assert depot_buy.transfer_original_type is None


def test_chains_the_whole_broker_purchase_depot_and_cash_side(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        _, cash, depot, flow = _make_broker_setup(session=session, user=user)
        depot_buy = make_transaction(
            session,
            account_id=depot.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=6),
            transaction_type=TransactionType.BUY,
        )
        cash_buy = make_transaction(
            session,
            account_id=cash.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=7),
            transaction_type=TransactionType.BUY,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert depot_buy.flow_id == flow.id
        assert depot_buy.transaction_type == TransactionType.BUY
        assert cash_buy.flow_id == flow.id
        assert cash_buy.transaction_type == TransactionType.TRANSFER_OUT
        assert cash_buy.transfer_original_type == TransactionType.BUY


def test_never_chains_a_lone_cash_leg_without_a_depot_mirror(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        _, cash, _, _ = _make_broker_setup(session=session, user=user)
        lone_cash = make_transaction(
            session,
            account_id=cash.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE + timedelta(days=2),
            transaction_type=TransactionType.BUY,
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert lone_cash.flow_id is None


def test_never_chains_a_pending_broker_leg(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        _, _, depot, _ = _make_broker_setup(session=session, user=user)
        pending_buy = make_transaction(
            session, account_id=depot.id, amount=-DEFAULT_AMOUNT, date=RECENT_DATE, transaction_type=TransactionType.BUY
        )
        pending_buy.pending = True
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert pending_buy.flow_id is None


def test_does_not_chain_a_broker_leg_of_a_different_amount(session_factory: sessionmaker):
    with session_factory() as session:
        user = make_user(session)
        _, _, depot, _ = _make_broker_setup(session=session, user=user)
        other_buy = make_transaction(
            session, account_id=depot.id, amount=-LARGE_AMOUNT, date=RECENT_DATE, transaction_type=TransactionType.BUY
        )
        session.flush()

        transfer_detection.detect_transfers_for_user(db_session=session, user=user)

        assert other_buy.flow_id is None


def test_startup_detection_links_across_all_users(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    # The startup backfill opens its own session per SessionLocal, iterates every user, and commits.
    monkeypatch.setattr(target=transfer_detection, name="SessionLocal", value=session_factory)
    with session_factory() as session:
        user = make_user(session)
        account_a, account_b = _create_two_accounts(session, user_id=user.id)
        out_id = make_transaction(
            session,
            account_id=account_a.id,
            amount=-DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.OUTGOING,
        ).id
        in_id = make_transaction(
            session,
            account_id=account_b.id,
            amount=DEFAULT_AMOUNT,
            date=RECENT_DATE,
            transaction_type=TransactionType.INCOMING,
        ).id
        session.commit()

    transfer_detection.detect_transfers_for_all_users()

    with session_factory() as session:
        out_flow = session.get(entity=Transaction, ident=out_id).flow_id
        assert out_flow is not None
        assert out_flow == session.get(entity=Transaction, ident=in_id).flow_id
