import asyncio
from datetime import timedelta

from source.backend.db import SessionLocal
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_type import TransactionType
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

ELIGIBLE_TYPES = frozenset(
    {
        TransactionType.INCOMING,
        TransactionType.OUTGOING,
        TransactionType.DEPOSIT,
        TransactionType.REMOVAL,
    }
)

AMOUNT_TOLERANCE = 1.0  # the two legs may differ by up to this (fees, rounding) in <unit of money>
MAX_DISTANCE = timedelta(days=5)


def _is_match(outflow: Transaction, inflow: Transaction) -> bool:
    if inflow.account_id == outflow.account_id:
        return False
    if abs(outflow.amount + inflow.amount) > AMOUNT_TOLERANCE:
        return False
    return abs(outflow.date - inflow.date) <= MAX_DISTANCE


def _candidate_rank(outflow: Transaction, inflow: Transaction) -> tuple:
    # Matching: closest amount, then a matching purpose, then closest date, then id.
    purpose_matches = outflow.purpose is not None and outflow.purpose == inflow.purpose
    return (
        abs(outflow.amount + inflow.amount),
        0 if purpose_matches else 1,
        abs(outflow.date - inflow.date),
        inflow.id,
    )


def detect_transfers_for_user(db_session: Session, user_id: int) -> int:
    unpaired_transactions = list(
        db_session.scalars(
            select(Transaction)
            .join(Account, onclause=Transaction.account_id == Account.id)
            .join(Credential, onclause=Account.credential_id == Credential.id)
            .where(Credential.user_id == user_id)
            .where(Transaction.transfer_counterpart_id.is_(None))
            .where(Transaction.transaction_type.in_(ELIGIBLE_TYPES))
        )
    )
    outflows = sorted((t for t in unpaired_transactions if t.amount < 0), key=lambda t: (t.date, t.id))
    inflows = [t for t in unpaired_transactions if t.amount > 0]
    logger.debug(
        f"Transfer detection for user {user_id}: {len(unpaired_transactions)} unpaired candidate(s) "
        f"({len(outflows)} outflow(s), {len(inflows)} inflow(s))"
    )

    consumed_inflow_ids: set[int] = set()
    created = 0
    for outflow in outflows:
        candidates = [
            inflow
            for inflow in inflows
            if inflow.id not in consumed_inflow_ids and _is_match(outflow=outflow, inflow=inflow)
        ]
        if not candidates:
            logger.debug(f"No transfer match for outflow {outflow.id} ({outflow.amount} on {outflow.date})")
            continue
        best = min(candidates, key=lambda inflow: _candidate_rank(outflow=outflow, inflow=inflow))
        outflow.transaction_type = TransactionType.TRANSFER_OUT
        best.transaction_type = TransactionType.TRANSFER_IN
        outflow.transfer_counterpart_id = best.id
        best.transfer_counterpart_id = outflow.id
        consumed_inflow_ids.add(best.id)
        created += 1
        logger.debug(
            f"Matched transfer: outflow {outflow} <-> inflow {best.id}; {len(candidates)} candidate(s) considered"
        )

    logger.info(f"Transfer detection for user {user_id}: {created} new transfer pair(s)")
    return created


def detect_all_transfers_sync() -> None:
    with SessionLocal() as db_session:
        user_ids = list(db_session.scalars(select(Credential.user_id).distinct()))
        for user_id in user_ids:
            detect_transfers_for_user(db_session=db_session, user_id=user_id)
        db_session.commit()


async def run_startup_transfer_detection() -> None:
    try:
        await asyncio.to_thread(detect_all_transfers_sync)
    except Exception:
        logger.exception(message="Startup transfer detection crashed")
