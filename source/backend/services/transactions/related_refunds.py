import datetime
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.api.schemas.transactions.transaction import RefundStatus, TransactionRead
from source.backend.models.transactions.transaction import Transaction

# Amounts are floats; a returned debit credits back the exact cent, so half a cent of slack absorbs float wobble.
_EPS = 0.005


@dataclass
class _Leg:
    id: int
    amount: float
    account_id: int
    date: datetime.date
    other_party: str | None
    remaining: float = 0.0

    def __post_init__(self) -> None:
        self.remaining = abs(self.amount)

    @property
    def booked(self) -> tuple[datetime.date, int]:
        return self.date, self.id


@dataclass
class RelatedGroupAnalysis:
    hidden_ids: set[int] = field(default_factory=set)  # fully canceled legs
    refund_status: dict[int, RefundStatus] = field(default_factory=dict)


def analyze(db_session: Session, related_group_ids: set[int] | None = None) -> RelatedGroupAnalysis:
    if related_group_ids is not None and not related_group_ids:
        return RelatedGroupAnalysis()
    query = select(  # noqa: FKA100
        Transaction.id,
        Transaction.related_group_id,
        Transaction.amount,
        Transaction.account_id,
        Transaction.date,
        Transaction.other_party,
    ).where(Transaction.related_group_id.isnot(None))
    if related_group_ids is not None:
        query = query.where(Transaction.related_group_id.in_(related_group_ids))

    legs_by_related_group: dict[int, list[_Leg]] = defaultdict(list)
    for transaction_id, related_group_id, amount, account_id, date, other_party in db_session.execute(query):
        legs_by_related_group[related_group_id].append(
            _Leg(id=transaction_id, amount=amount, account_id=account_id, date=date, other_party=other_party)
        )

    analysis = RelatedGroupAnalysis()
    for legs in legs_by_related_group.values():
        _analyze_related_group(legs=legs, analysis=analysis)
    return analysis


def annotate_transactions(
    db_session: Session, transactions: Iterable[Transaction], reads: list[TransactionRead]
) -> None:
    related_group_ids = {
        transaction.related_group_id for transaction in transactions if transaction.related_group_id is not None
    }
    if not related_group_ids:
        return
    refund_status = analyze(db_session=db_session, related_group_ids=related_group_ids).refund_status
    for read in reads:
        read.refund_status = refund_status.get(read.id)


def _analyze_related_group(legs: list[_Leg], analysis: RelatedGroupAnalysis) -> None:
    inflows = sorted((leg for leg in legs if leg.amount > 0), key=lambda leg: (leg.date, leg.id))
    outflows = [leg for leg in legs if leg.amount < 0]
    refund_inflows: set[int] = set()
    covered_outflows: dict[int, list[int]] = defaultdict(list)

    for same_account in (True, False):
        for inflow in inflows:
            if inflow.remaining <= _EPS:
                continue
            candidates = sorted(
                (out for out in outflows if (out.account_id == inflow.account_id) == same_account),
                key=lambda out: (out.booked > inflow.booked, abs(out.remaining - inflow.remaining) > _EPS, out.id),
            )
            for outflow in candidates:
                if inflow.remaining <= _EPS:
                    break
                # A cross-account transfer only cancels an exactly equal leg; a same-account refund may be partial.
                if outflow.remaining <= _EPS or (not same_account and abs(outflow.remaining - inflow.remaining) > _EPS):
                    continue
                applied = min(inflow.remaining, outflow.remaining)
                inflow.remaining -= applied
                outflow.remaining -= applied
                same_party = inflow.other_party is not None and inflow.other_party == outflow.other_party
                if same_account and (outflow.booked < inflow.booked or same_party):
                    refund_inflows.add(inflow.id)
                    covered_outflows[inflow.id].append(outflow.id)

    refunded = {out_id for out_ids in covered_outflows.values() for out_id in out_ids}
    fully_cancelled = {leg.id for leg in legs if leg.remaining <= _EPS}

    for outflow in outflows:
        if outflow.id in fully_cancelled:
            analysis.hidden_ids.add(outflow.id)
            if outflow.id in refunded:
                analysis.refund_status[outflow.id] = RefundStatus.REFUNDED
        elif outflow.id in refunded:
            analysis.refund_status[outflow.id] = RefundStatus.PARTIALLY_REFUNDED

    for inflow in inflows:
        if inflow.id in refund_inflows:
            analysis.refund_status[inflow.id] = RefundStatus.REFUND
        # Hide a fully-consumed inflow only when it settled transfers/full refunds; a partial refund's credit stays.
        if inflow.remaining <= _EPS and all(out_id in fully_cancelled for out_id in covered_outflows[inflow.id]):
            analysis.hidden_ids.add(inflow.id)
