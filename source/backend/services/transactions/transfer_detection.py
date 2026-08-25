import asyncio
from collections.abc import Callable
from datetime import timedelta
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.db import SessionLocal
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_balance_snapshot import AccountBalanceSnapshot, BalanceSnapshotSource
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.transactions.flow_link_source import FlowLinkSource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory, normalize_string
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.models.transactions.transfer_flow import TransferFlow
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

TRANSFER_MAX_DISTANCE = timedelta(days=3)

# A refund may not match its original payment by amount (partial refunds) or a tight date, so it gets a wider
# window and is matched by the shared counterparty name instead.
REFUND_MAX_DISTANCE = timedelta(days=31)

# Broker legs (a Sparplan deposit, the cash-side buy, its depot mirror booking) settle days apart and don't
# share a sign, so they get a wider, credential-scoped window instead of the strict transfer match.
BROKER_LEG_MAX_DISTANCE = timedelta(days=31)


def _is_match(outflow: Transaction, inflow: Transaction) -> bool:
    if outflow.amount != -inflow.amount:
        return False
    return abs(outflow.date - inflow.date) <= TRANSFER_MAX_DISTANCE


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
            .where(Transaction.flow_id.is_(None))
            .where(Transaction.transaction_type.in_(ELIGIBLE_TYPES))
            .where(Transaction.transfer_relink_blocked.is_(False))
            .where(Transaction.pending.is_(False))  # Pending entries are ephemeral; never link them as transfers.
        )
    )
    created_transfers = _link_transfer_pairs(db_session=db_session, transactions=unpaired_transactions)
    mirrored = _link_mirror_bookings(db_session=db_session, transactions=unpaired_transactions)
    refunds_linked = _link_refunds_to_payments(db_session=db_session, transactions=unpaired_transactions)
    chained = _chain_into_detected_flows(db_session=db_session, user=user, unlinked=unpaired_transactions)
    broker_chained = _chain_broker_legs(db_session=db_session, user=user)
    logger.info(
        f"Transfer detection for {user}: {created_transfers} new transfer pair(s), "
        f"{mirrored} new mirror pair(s), {refunds_linked} refund(s) linked to a payment, "
        f"{chained} leg(s) chained into existing flows, {broker_chained} broker leg(s) chained"
    )
    return created_transfers + mirrored + refunds_linked + chained + broker_chained


def detect_transfers_for_all_users() -> None:
    with SessionLocal() as db_session:
        users = db_session.scalars(select(User)).all()
        logger.info(f"Running transfer detection for {len(users)} user(s)")
        for user in users:
            detect_transfers_for_user(db_session=db_session, user=user)
            db_session.commit()


async def run_startup_detection() -> None:
    try:
        await asyncio.to_thread(detect_transfers_for_all_users)
    except Exception:
        logger.exception(message="Startup transfer detection backfill crashed")


def _new_flow(db_session: Session) -> TransferFlow:
    flow = TransferFlow()
    db_session.add(flow)
    db_session.flush()
    return flow


def _link_transfer_pairs(db_session: Session, transactions: list[Transaction]) -> int:
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
        flow = _new_flow(db_session=db_session)
        outflow.transfer_original_type = outflow.transaction_type
        best.transfer_original_type = best.transaction_type
        outflow.transaction_type = TransactionType.TRANSFER_OUT
        best.transaction_type = TransactionType.TRANSFER_IN
        outflow.flow_id = flow.id
        best.flow_id = flow.id
        outflow.flow_link_source = FlowLinkSource.DETECTED
        best.flow_link_source = FlowLinkSource.DETECTED
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
    if abs(funding_leg.date - intermediary_leg.date) > TRANSFER_MAX_DISTANCE:
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


def _link_mirror_bookings(db_session: Session, transactions: list[Transaction]) -> int:
    # Pair intermediary-account bookings (e.g. PayPal) with their same-signed funding leg.
    intermediaries = _intermediary_accounts(transactions=transactions)
    if not intermediaries:
        return 0

    pool = [t for t in transactions if t.flow_id is None]
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
        flow = _new_flow(db_session=db_session)
        best.transfer_original_type = best.transaction_type
        best.transaction_type = TransactionType.TRANSFER_OUT if best.amount < 0 else TransactionType.TRANSFER_IN
        best.flow_id = flow.id
        intermediary_leg.flow_id = flow.id
        best.flow_link_source = FlowLinkSource.DETECTED
        intermediary_leg.flow_link_source = FlowLinkSource.DETECTED
        consumed_funding_ids.add(best.id)
        created += 1
        logger.debug(
            f"Matched mirror booking: Funding {best} <-> Intermediary {intermediary_leg}; "
            f"{len(candidates)} candidate(s) considered"
        )
    return created


def _link_refunds_to_payments(db_session: Session, transactions: list[Transaction]) -> int:
    # A bank-flagged refund (category REIMBURSEMENT) names the same counterparty as the payment it reverses,
    # but its amount is often smaller (partial refund) and it can land weeks later, so amount/date matching
    # misses it. Link it to the single open outflow to that same party that covers it within REFUND_MAX_DISTANCE.
    # Ambiguous (0 or >1 candidates) -> skip, matching the other passes' conservatism.
    refunds = [
        t
        for t in transactions
        if t.flow_id is None and t.amount > 0 and t.category == TransactionCategory.REIMBURSEMENT and t.other_party
    ]
    consumed_outflow_ids: set[int] = set()
    created = 0
    for refund in refunds:
        party = normalize_string(refund.other_party or "")
        candidates = [
            outflow
            for outflow in transactions
            if outflow.flow_id is None
            and outflow.id not in consumed_outflow_ids
            and outflow.amount < 0
            and abs(outflow.amount) >= refund.amount
            and outflow.date <= refund.date
            and (refund.date - outflow.date) <= REFUND_MAX_DISTANCE
            and normalize_string(outflow.other_party or "") == party
        ]
        if len(candidates) != 1:
            continue
        outflow = candidates[0]
        flow = _new_flow(db_session=db_session)
        outflow.transfer_original_type = outflow.transaction_type
        refund.transfer_original_type = refund.transaction_type
        outflow.transaction_type = TransactionType.TRANSFER_OUT
        refund.transaction_type = TransactionType.TRANSFER_IN
        outflow.flow_id = flow.id
        refund.flow_id = flow.id
        outflow.flow_link_source = FlowLinkSource.DETECTED
        refund.flow_link_source = FlowLinkSource.DETECTED
        consumed_outflow_ids.add(outflow.id)
        created += 1
        logger.debug(f"Linked refund {refund} to payment {outflow}")
    return created


def _is_open_end(member: Transaction, flow_members: list[Transaction]) -> bool:
    # A member is an open end if its cross-account counter-leg is still missing from the flow: money can
    # only be forwarded once. A same-account counter-booking (reimbursement) does _not_ close it.
    return not any(other.amount == -member.amount and other.account_id != member.account_id for other in flow_members)


def _chain_into_detected_flows(db_session: Session, user: User, unlinked: list[Transaction]) -> int:
    members_by_flow: dict[int, list[Transaction]] = {}
    for member in db_session.scalars(
        select(Transaction)
        .join(Account, onclause=Transaction.account_id == Account.id)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
        .where(Transaction.flow_id.is_not(None))
        .where(Transaction.flow_link_source == FlowLinkSource.DETECTED)
        .where(Transaction.pending.is_(False))
    ):
        members_by_flow.setdefault(cast(int, member.flow_id), []).append(member)  # noqa: FKA100
    candidates = [leg for leg in unlinked if leg.flow_id is None]

    created = 0
    progressed = True
    while progressed:
        progressed = False
        for leg in candidates:
            if leg.flow_id is not None:
                continue
            matched_flows = {
                flow_id
                for flow_id, members in members_by_flow.items()
                if any(
                    _is_open_end(member=m, flow_members=members) and _is_chain_hop(leg=leg, member=m) for m in members
                )
            }
            if len(matched_flows) != 1:  # 0 = no match, >1 = ambiguous; both skip
                continue
            flow_id = matched_flows.pop()
            leg.transfer_original_type = leg.transaction_type
            leg.transaction_type = TransactionType.TRANSFER_OUT if leg.amount < 0 else TransactionType.TRANSFER_IN
            leg.flow_id = flow_id
            leg.flow_link_source = FlowLinkSource.DETECTED
            members_by_flow[flow_id].append(leg)
            created += 1
            progressed = True
            logger.debug(f"Chained {leg} into flow {flow_id}")
    return created


def _is_chain_hop(leg: Transaction, member: Transaction) -> bool:
    # A leg chains onto a flow member in two shapes, both within TRANSFER_MAX_DISTANCE:
    #  - cross-account self-transfer: exact counter-amount on a *different* account (the classic hop), or
    #  - same-account retry cluster: same |amount| and same counterparty on the *same* account
    #    (e.g. a rejected debit re-attempted
    if abs(leg.date - member.date) > TRANSFER_MAX_DISTANCE:
        return False
    if leg.account_id == member.account_id:
        party = normalize_string(leg.other_party or "")
        if not party or party != normalize_string(member.other_party or ""):
            return False
        if any(name in party for name, _ in INTERMEDIARIES):
            return False
        return abs(leg.amount) == abs(member.amount)
    outflow, inflow = (leg, member) if leg.amount < 0 else (member, leg)
    return _is_match(outflow=outflow, inflow=inflow)


def _market_valued_account_ids(db_session: Session) -> set[int]:
    return set(
        db_session.scalars(
            select(AccountBalanceSnapshot.account_id)
            .where(AccountBalanceSnapshot.source == BalanceSnapshotSource.MARKET_VALUED)
            .distinct()
        )
    )


def _attach_broker_leg(leg: Transaction, flow_id: int, market_valued_ids: set[int]) -> None:
    # Market-valued depot legs keep their BUY/SELL type: the depot sign-flip (see flip_depot_signs) depends on it.
    # Cash-side legs become plain transfers like any other flow member.
    if leg.account_id not in market_valued_ids:
        leg.transfer_original_type = leg.transaction_type
        leg.transaction_type = TransactionType.TRANSFER_OUT if leg.amount < 0 else TransactionType.TRANSFER_IN
    leg.flow_id = flow_id
    leg.flow_link_source = FlowLinkSource.DETECTED


def _chain_broker_legs(db_session: Session, user: User) -> int:
    # A broker purchase (deposit -> cash-side buy -> depot mirror booking) spreads legs of the same amount across
    # the broker's cash and depot accounts, days apart and not sign-opposed, so the strict transfer match misses
    # them. Attach such a leg to a DETECTED flow when exactly one flow already holds a member on the SAME
    # credential with the same absolute amount within BROKER_LEG_MAX_DISTANCE. Scoped to broker credentials.
    market_valued_ids = _market_valued_account_ids(db_session=db_session)
    broker_credential_ids = set(
        db_session.scalars(
            select(Account.credential_id)
            .join(Credential, onclause=Account.credential_id == Credential.id)
            .where(Credential.user_id == user.id)
            .where(Account.id.in_(market_valued_ids))
        )
    )
    if not broker_credential_ids:
        return 0

    members = []
    flows_with_depot: set[int] = set()
    for row in db_session.execute(
        select(  # noqa: FKA100
            Transaction.flow_id, Account.credential_id, Transaction.amount, Transaction.date, Transaction.account_id
        )
        .join(Account, onclause=Transaction.account_id == Account.id)
        .where(Transaction.flow_id.is_not(None))
        .where(Transaction.flow_link_source == FlowLinkSource.DETECTED)
        .where(Account.credential_id.in_(broker_credential_ids))
    ):
        members.append((row.flow_id, row.credential_id, abs(row.amount), row.date))
        if row.account_id in market_valued_ids:
            flows_with_depot.add(row.flow_id)
    candidates = list(
        db_session.scalars(
            select(Transaction)
            .join(Account, onclause=Transaction.account_id == Account.id)
            .where(Transaction.flow_id.is_(None))
            .where(Transaction.pending.is_(False))
            .where(Account.credential_id.in_(broker_credential_ids))
        )
    )

    created = 0
    progressed = True
    while progressed:  # fixpoint: a chained leg becomes a member the next leg can match against
        progressed = False
        for leg in candidates:
            if leg.flow_id is not None:
                continue
            leg_is_depot = leg.account_id in market_valued_ids
            leg_credential_id = leg.account.credential_id
            matched_flows = {
                flow_id
                for flow_id, credential_id, amount, member_date in members
                if credential_id == leg_credential_id
                and amount == abs(leg.amount)
                and abs(member_date - leg.date) <= BROKER_LEG_MAX_DISTANCE
                and (leg_is_depot or flow_id in flows_with_depot)
            }
            if len(matched_flows) != 1:  # 0 = no match, >1 = ambiguous; both skip
                continue
            flow_id = matched_flows.pop()
            _attach_broker_leg(leg=leg, flow_id=flow_id, market_valued_ids=market_valued_ids)
            members.append((flow_id, leg_credential_id, abs(leg.amount), leg.date))
            if leg_is_depot:
                flows_with_depot.add(flow_id)
            created += 1
            progressed = True
            logger.debug(f"Chained broker leg {leg} into flow {flow_id}")
    return created
