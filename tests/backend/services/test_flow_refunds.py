from sqlalchemy.orm import sessionmaker

from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.services.transactions import flow_refunds
from tests.backend.conftest import (
    DEFAULT_AMOUNT,
    LATEST_DATE,
    OLDER_DATE,
    RECENT_DATE,
    SECOND_AMOUNT,
    link_transactions_as_flow,
    make_account,
    make_transaction,
    make_user_and_credential_and_account,
)


def test_returned_payment_and_retry_hides_the_reversed_pair_and_badges_it(session_factory: sessionmaker):
    with session_factory() as session:
        _, _, account = make_user_and_credential_and_account(session, name="Cash")
        returned = make_transaction(
            session, account_id=account.id, amount=-DEFAULT_AMOUNT, category=TransactionCategory.TRAVEL, date=OLDER_DATE
        )
        reimbursement = make_transaction(
            session,
            account_id=account.id,
            amount=DEFAULT_AMOUNT,
            category=TransactionCategory.REIMBURSEMENT,
            date=OLDER_DATE,
        )
        retry = make_transaction(
            session,
            account_id=account.id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.TRAVEL,
            date=LATEST_DATE,
        )
        session.flush()
        link_transactions_as_flow(db_session=session, transactions=[returned, reimbursement, retry])
        session.commit()
        returned_id, reimbursement_id, retry_id = returned.id, reimbursement.id, retry.id

        analysis = flow_refunds.analyze(db_session=session)

    assert analysis.hidden_ids == {returned_id, reimbursement_id}
    assert analysis.refund_status == {returned_id: "refunded", reimbursement_id: "refund"}
    assert retry_id not in analysis.refund_status


def test_cross_account_transfer_is_hidden_but_not_badged(session_factory: sessionmaker):
    with session_factory() as session:
        _, credential, source = make_user_and_credential_and_account(session, name="Checking")
        target = make_account(session, credential_id=credential.id, name="Savings")
        out = make_transaction(session, account_id=source.id, amount=-DEFAULT_AMOUNT, date=OLDER_DATE)
        incoming = make_transaction(session, account_id=target.id, amount=DEFAULT_AMOUNT, date=RECENT_DATE)
        session.flush()
        link_transactions_as_flow(db_session=session, transactions=[out, incoming])
        session.commit()
        ids = {out.id, incoming.id}

        analysis = flow_refunds.analyze(db_session=session)

    assert analysis.hidden_ids == ids
    assert analysis.refund_status == {}


def test_partial_refund_keeps_both_legs_visible_and_badges_partial(session_factory: sessionmaker):
    with session_factory() as session:
        _, _, account = make_user_and_credential_and_account(session, name="Cash")
        payment = make_transaction(
            session,
            account_id=account.id,
            amount=-DEFAULT_AMOUNT,
            category=TransactionCategory.ONLINE_SHOPPING,
            date=OLDER_DATE,
        )
        partial = make_transaction(
            session,
            account_id=account.id,
            amount=SECOND_AMOUNT,
            category=TransactionCategory.REIMBURSEMENT,
            date=RECENT_DATE,
        )
        session.flush()
        link_transactions_as_flow(db_session=session, transactions=[payment, partial])
        session.commit()
        payment_id, partial_id = payment.id, partial.id

        analysis = flow_refunds.analyze(db_session=session)

    assert analysis.hidden_ids == set()
    assert analysis.refund_status == {payment_id: "partially_refunded", partial_id: "refund"}
