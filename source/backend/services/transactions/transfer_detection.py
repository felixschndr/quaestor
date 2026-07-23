from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory, normalize_string
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.contracts.contract_aggregators import INTERMEDIARIES

logger = get_logger(__name__)

ELIGIBLE_TYPES = frozenset(
    {
        TransactionType.INCOMING,
        TransactionType.OUTGOING,
        TransactionType.DEPOSIT,
        TransactionType.REMOVAL,
    }
)

MAX_DISTANCE = timedelta(days=5)


def _is_match(outflow: Transaction, inflow: Transaction) -> bool:
    if outflow.amount != -inflow.amount:
        return False
    return abs(outflow.date - inflow.date) <= MAX_DISTANCE


def _candidate_rank(outflow: Transaction, inflow: Transaction) -> tuple:
    # Amounts already match exactly, so rank by a matching purpose first, then closest date, then id.
    # A different-account candidate (real transfer) beats a same-account one (refund/reversal).
    purpose_matches = outflow.purpose is not None and outflow.purpose == inflow.purpose
    return (
        0 if purpose_matches else 1,
        0 if inflow.account_id != outflow.account_id else 1,
        abs(outflow.date - inflow.date),
        inflow.id,
    )


def detect_transfers_for_user(db_session: Session, user: User) -> int:
    unpaired_transactions = list(
        db_session.scalars(
            select(Transaction)
            .join(Account, onclause=Transaction.account_id == Account.id)
            .join(Credential, onclause=Account.credential_id == Credential.id)
            .where(Credential.user_id == user.id)
            .where(Transaction.transfer_counterpart_id.is_(None))
            .where(Transaction.transaction_type.in_(ELIGIBLE_TYPES))
            .where(Transaction.transfer_relink_blocked.is_(False))
            .where(Transaction.pending.is_(False))  # Pending entries are ephemeral; never link them as transfers.
        )
    )
    created_transfers = _link_transfer_pairs(transactions=unpaired_transactions)
    mirrored = _link_mirror_bookings(transactions=unpaired_transactions)
    logger.info(
        f"Transfer detection for {user}: {created_transfers} new transfer pair(s), {mirrored} new mirror pair(s)"
    )
    return created_transfers + mirrored


def _link_transfer_pairs(transactions: list[Transaction]) -> int:
    outflows = sorted((t for t in transactions if t.amount < 0), key=lambda t: (t.date, t.id))
    inflows = [t for t in transactions if t.amount > 0]
    logger.debug(
        f"Transfer detection: {len(transactions)} unpaired candidate(s) "
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
            logger.debug(f"No transfer match for outflow {outflow}")
            continue
        best = min(candidates, key=lambda inflow: _candidate_rank(outflow=outflow, inflow=inflow))
        outflow.transfer_original_type = outflow.transaction_type
        best.transfer_original_type = best.transaction_type
        outflow.transaction_type = TransactionType.TRANSFER_OUT
        best.transaction_type = TransactionType.TRANSFER_IN
        outflow.transfer_counterpart_id = best.id
        best.transfer_counterpart_id = outflow.id
        if best.account_id == outflow.account_id:
            best.category = TransactionCategory.REIMBURSEMENT
        consumed_inflow_ids.add(best.id)
        created += 1
        logger.debug(
            f"Matched transfer: Outflow {outflow} <-> Inflow {best}; {len(candidates)} candidate(s) considered"
        )
    return created


def _intermediary_accounts(transactions: list[Transaction]) -> dict[int, tuple[str, "Callable[[str], str | None]"]]:
    intermediaries = {}
    for account in {t.account for t in transactions}:
        aspsp_name = normalize_string(account.credential.credentials.get("aspsp_name") or "")
        for name, extract_merchant in INTERMEDIARIES:
            if name in aspsp_name:
                intermediaries[account.id] = (name, extract_merchant)
    return intermediaries


def _is_mirror_match(intermediary_leg: Transaction, funding_leg: Transaction, intermediary_name: str) -> bool:
    if funding_leg.amount != intermediary_leg.amount:
        return False
    if abs(funding_leg.date - intermediary_leg.date) > MAX_DISTANCE:
        return False
    return intermediary_name in normalize_string(funding_leg.other_party or "")


def _mirror_rank(
    intermediary_leg: Transaction, funding_leg: Transaction, extract_merchant: "Callable[[str], str | None]"
) -> tuple:
    merchant = extract_merchant(funding_leg.purpose or "")
    merchant_matches = merchant is not None and normalize_string(merchant) in normalize_string(
        intermediary_leg.other_party or ""
    )
    return (
        0 if merchant_matches else 1,
        abs(funding_leg.date - intermediary_leg.date),
        funding_leg.id,
    )


def _link_mirror_bookings(transactions: list[Transaction]) -> int:
    # Pair intermediary-account bookings (e.g. PayPal) with their same-signed funding leg.
    intermediaries = _intermediary_accounts(transactions=transactions)
    if not intermediaries:
        return 0

    pool = [t for t in transactions if t.transfer_counterpart_id is None]
    intermediary_legs = sorted((t for t in pool if t.account_id in intermediaries), key=lambda t: (t.date, t.id))
    funding_legs = [t for t in pool if t.account_id not in intermediaries]

    consumed_funding_ids: set[int] = set()
    created = 0
    for intermediary_leg in intermediary_legs:
        name, extract_merchant = intermediaries[intermediary_leg.account_id]
        candidates = [
            funding_leg
            for funding_leg in funding_legs
            if funding_leg.id not in consumed_funding_ids
            and _is_mirror_match(intermediary_leg=intermediary_leg, funding_leg=funding_leg, intermediary_name=name)
        ]
        if not candidates:
            continue
        best = min(
            candidates,
            key=lambda funding_leg: _mirror_rank(
                intermediary_leg=intermediary_leg, funding_leg=funding_leg, extract_merchant=extract_merchant
            ),
        )
        best.transfer_original_type = best.transaction_type
        best.transaction_type = TransactionType.TRANSFER_OUT if best.amount < 0 else TransactionType.TRANSFER_IN
        best.transfer_counterpart_id = intermediary_leg.id
        intermediary_leg.transfer_counterpart_id = best.id
        consumed_funding_ids.add(best.id)
        created += 1
        logger.debug(
            f"Matched mirror booking: Funding {best} <-> Intermediary {intermediary_leg}; "
            f"{len(candidates)} candidate(s) considered"
        )
    return created
