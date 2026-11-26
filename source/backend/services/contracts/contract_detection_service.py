import asyncio
import datetime
import re
from collections import defaultdict
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.db import SessionLocal
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.contracts.contract import OUTLIER_ABSOLUTE_FLOOR, Contract
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.contracts.contract_frequency import ContractFrequency
from source.backend.models.contracts.contract_source import ContractSource
from source.backend.models.transactions.category_source import CategorySource
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import (
    CategorizationRules,
    CategoryGroup,
    TransactionCategory,
    expand_category_selection,
    normalize_string,
)
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.contracts.contract_aggregators import INTERMEDIARIES, compute_fingerprint

logger = get_logger(__name__)

MIN_TRANSACTIONS_PER_CONTRACT = 3
# How far a single gap (in days) may deviate from a canonical interval and still count as a match, as a fraction of that
# interval.
# Example: 0.25 -> a monthly gap may be 30 +/- ~7 days.
MAX_INTERVAL_DEVIATION_FRACTION = 0.25
# Fraction of the actual gaps that must land on the chosen interval.
# Guards against series whose median gap happens to align with a cadence while the individual gaps are erratic.
MIN_MATCHING_GAP_FRACTION = 0.6
# Reject groups whose amounts scatter too far around their median, measured as Median Absolute Deviation / |median|.
MAX_AMOUNT_DEVIATION_FRACTION = 0.5
# A transaction only joins a contract when its amount is within this ratio of the group median (--> between median/K and
# median*K). Guards against unrelated payments that merely share a counterparty (e.g. a one-off reimbursement or bonus
# landing in a salary series) being swept into the contract: those are a small *fraction* of the recurring amount and
# fall below median/K. A genuine spike (e.g. a yearly utility Nachzahlung that more than doubles a monthly bill) is a
# *multiple* of the norm, stays within median*K, and so survives as a flagged outlier instead of being ejected and
# silently escaping anomaly detection.
MEMBER_AMOUNT_MAX_RATIO = 3.0
# Amount statistics (median/spread, and therefore outlier detection) are computed over only the most recent members, so
# a sustained price change becomes the new normal instead of being flagged as an outlier forever.
RECENT_AMOUNT_WINDOW = 6
AUTO_ARCHIVE_OVERDUE = datetime.timedelta(days=365)
_NON_LETTERS = re.compile(r"[^a-z]+")

ELIGIBLE_TRANSACTION_TYPES = frozenset(
    {
        TransactionType.INCOMING,
        TransactionType.OUTGOING,
        TransactionType.DEPOSIT,
        TransactionType.REMOVAL,
        TransactionType.TRANSFER_IN,
        TransactionType.TRANSFER_OUT,
    }
)

BLACKLISTED_CATEGORIES = [
    CategoryGroup.FOOD_AND_DRINK,
    TransactionCategory.DRUGSTORE,
    TransactionCategory.PERSONAL_CARE,
    TransactionCategory.CLOTHING,
    TransactionCategory.GIFTS,
    TransactionCategory.INTEREST,
    TransactionCategory.REIMBURSEMENT,
    TransactionCategory.PRIVATE_SALES,
]


def detect_contracts_for_user(db_session: Session, user: User) -> list[Contract]:
    accounts = db_session.scalars(
        select(Account)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
    ).all()
    logger.debug(f"Running contract detection for {user} across {len(accounts)} account(s)")
    new_contracts = []
    for account in accounts:
        new_contracts.extend(detect_contracts_for_account(db_session=db_session, account=account))
    return new_contracts


def detect_contracts_for_all_users() -> None:
    with SessionLocal() as db_session:
        users = db_session.scalars(select(User)).all()
        logger.info(f"Running contract detection for {len(users)} user(s)")
        for user in users:
            detect_contracts_for_user(db_session=db_session, user=user)
            db_session.commit()


async def run_startup_detection() -> None:
    try:
        await asyncio.to_thread(detect_contracts_for_all_users)
    except Exception:
        logger.exception(message="Startup contract detection backfill crashed")


def detect_contracts_for_account(db_session: Session, account: Account) -> list[Contract]:
    prior_member_ids: dict[int, set[int]] = defaultdict(set)
    for transaction in account.transactions:
        if transaction.contract_id is not None and transaction.contract_assignment != ContractAssignment.EXCLUDED:
            prior_member_ids[transaction.contract_id].add(transaction.id)
    _release_auto_assignments(db_session=db_session, account=account)
    eligible = _get_eligible_transactions(db_session=db_session, account=account)
    blacklisted_categories = frozenset(
        expand_category_selection(
            selection=BLACKLISTED_CATEGORIES, custom_groups=account.credential.user.custom_category_groups
        )
    )
    groups = _group_by_fingerprint(
        eligible,
        suppressed_intermediaries=_get_connected_intermediaries(db_session=db_session, account=account),
        blacklisted_categories=blacklisted_categories,
    )
    logger.debug(
        f"Contract detection on {account}: {len(eligible)} eligible transaction(s) in {len(groups)} fingerprint group(s)"
    )

    detected = 0
    new_contracts = []
    for (fingerprint, display_name), transactions in groups.items():
        if fingerprint in account.dismissed_contract_fingerprints:
            logger.debug(f"Group '{display_name}' ({fingerprint}) was dismissed by the user; skipping")
            continue
        members = _members_within_amount_band(transactions)
        dropped = len(transactions) - len(members)
        if dropped:
            logger.debug(
                f"Group '{display_name}' ({fingerprint}): dropped {dropped} transaction(s) whose amount is too far "
                "from the group median to belong to the contract"
            )
        if len(members) < MIN_TRANSACTIONS_PER_CONTRACT:
            continue

        frequency, interval_days = _classify_cadence([transaction.date for transaction in members])
        if frequency is None:
            logger.debug(f"Group '{display_name}' ({fingerprint}) with {len(members)} transaction(s) is not recurring")
            continue

        if not _amounts_are_consistent([transaction.amount for transaction in members]):
            logger.debug(
                f"Group '{display_name}' ({fingerprint}) with {len(members)} transaction(s) "
                "has inconsistent amounts; skipping"
            )
            continue

        contract, created = _find_or_create_contract(
            db_session=db_session, account=account, fingerprint=fingerprint, display_name=display_name
        )
        if created:
            new_contracts.append(contract)
        for transaction in members:
            transaction.contract_id = contract.id
            transaction.contract_assignment = ContractAssignment.AUTO

        prior_ids = prior_member_ids.get(contract.id) or set()
        if contract.is_archived and any(member.id not in prior_ids for member in members):
            contract.is_archived = False
            logger.info(f"Reactivated archived {contract} after new transaction(s) arrived")

        detected += 1
        logger.debug(f"Linked {len(members)} transaction(s) to {contract} " f"({frequency.value}, ~{interval_days}d)")

    db_session.flush()
    for contract in account.contracts:
        recompute_contract_stats(contract)
        archive_if_ended(contract)
        _archive_if_long_overdue(contract)
    _delete_empty_detected_contracts(db_session=db_session, account=account)
    db_session.flush()

    logger.info(
        f"Contract detection on {account}: {detected} recurring and {len(new_contracts)} newly created contract(s) "
        "detected"
    )
    return new_contracts


def _get_eligible_transactions(db_session: Session, account: Account) -> list[Transaction]:
    return list(
        db_session.scalars(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.pending.is_(False))
            .where(Transaction.contract_assignment.is_(None))
            .where(Transaction.transaction_type.in_(ELIGIBLE_TRANSACTION_TYPES))
        )
    )


def _get_connected_intermediaries(db_session: Session, account: Account) -> set[str]:
    credentials = db_session.scalars(select(Credential).where(Credential.user_id == account.credential.user_id)).all()
    intermediaries = set()
    for credential in credentials:
        aspsp_name = normalize_string(credential.credentials.get("aspsp_name") or "")
        for name, _ in INTERMEDIARIES:
            if name in aspsp_name:
                intermediaries.add(name)
    return intermediaries


def _group_by_fingerprint(
    transactions: list[Transaction], suppressed_intermediaries: set[str], blacklisted_categories: frozenset[str]
) -> dict[tuple[str, str], list[Transaction]]:
    groups: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
    for transaction in transactions:
        if transaction.category in blacklisted_categories:
            logger.debug(
                f"Skipping blacklisted other party '{transaction.other_party}' for contract detection since it is in a blacklisted category ({transaction.category})"
            )
            continue
        fingerprint = compute_fingerprint(transaction)
        if fingerprint is None:
            continue
        if fingerprint.key.split(sep=":", maxsplit=1)[0] in suppressed_intermediaries:
            logger.debug(
                f"Skipping intermediary-routed '{transaction.other_party}' ({fingerprint.key}); the connected "
                "intermediary account owns this contract"
            )
            continue

        direction = "in" if transaction.amount >= 0 else "out"
        key = f"{fingerprint.key}:{direction}"
        groups[(key, fingerprint.display_name)].append(transaction)

    split_groups: dict[tuple[str, str], list[Transaction]] = {}
    for (key, display_name), members in groups.items():
        split_groups.update(_split_parallel_series(key=key, display_name=display_name, transactions=members))
    return split_groups


def _split_parallel_series(
    key: str, display_name: str, transactions: list[Transaction]
) -> dict[tuple[str, str], list[Transaction]]:
    # One recipient can receive several standing orders, e.g. groceries and insurances to a household account. Split by
    # purpose only when at least two purposes recur at the same time: a standing order whose purpose was renamed runs
    # one purpose after the other and stays one contract under the unchanged key.
    by_purpose: dict[str, list[Transaction]] = defaultdict(list)
    for transaction in transactions:
        by_purpose[_normalized_purpose(transaction.purpose)].append(transaction)
    series = {
        purpose: members
        for purpose, members in by_purpose.items()
        if _classify_cadence([member.date for member in members])[0] is not None
    }
    if not _have_overlapping_series(list(series.values())):
        return {(key, display_name): transactions}

    groups: dict[tuple[str, str], list[Transaction]] = {}
    for purpose, members in series.items():
        latest_purpose = (max(members, key=lambda member: member.date).purpose or "").strip()
        groups[(f"{key}:purpose:{purpose}", " – ".join(filter(None, [display_name, latest_purpose])))] = members
    rest = [transaction for transaction in transactions if _normalized_purpose(transaction.purpose) not in series]
    if rest:
        groups[(key, display_name)] = rest
    logger.debug(f"Group '{display_name}' ({key}) holds {len(series)} parallel series; split them by purpose")
    return groups


def _normalized_purpose(purpose: str | None) -> str:
    # Drops digits, spaces and punctuation so a purpose carrying a month, an invoice number or a changed spacing still
    # matches its earlier payments
    return _NON_LETTERS.sub(repl="", string=normalize_string(purpose or ""))


def _have_overlapping_series(series: list[list[Transaction]]) -> bool:
    spans = sorted(
        (min(member.date for member in members), max(member.date for member in members)) for members in series
    )
    return any(later_start <= earlier_end for (_, earlier_end), (later_start, _) in zip(spans, spans[1:]))


def _classify_cadence(dates: list[datetime.date]) -> tuple[ContractFrequency | None, int | None]:
    if len(dates) < MIN_TRANSACTIONS_PER_CONTRACT:
        return None, None

    ordered = sorted(dates)
    gaps = [(later - earlier).days for earlier, later in zip(ordered, ordered[1:]) if later != earlier]
    if len(gaps) < MIN_TRANSACTIONS_PER_CONTRACT - 1:
        return None, None

    match_counts = {
        frequency: sum(1 for gap in gaps if _gap_matches(gap=gap, frequency=frequency))
        for frequency in ContractFrequency
    }
    best_frequency, best_match_count = max(match_counts.items(), key=lambda item: item[1])
    if best_match_count == 0:
        return None, None
    if best_match_count < MIN_TRANSACTIONS_PER_CONTRACT - 1 or best_match_count / len(gaps) < MIN_MATCHING_GAP_FRACTION:
        return None, None

    matching_gaps = [gap for gap in gaps if _gap_matches(gap=gap, frequency=best_frequency)]
    return best_frequency, round(median(matching_gaps))


def _gap_matches(gap: int, frequency: ContractFrequency) -> bool:
    return abs(gap - frequency.interval_days) / frequency.interval_days <= MAX_INTERVAL_DEVIATION_FRACTION


def _amounts_are_consistent(amounts: list[float]) -> bool:
    if not amounts:
        return False
    center = median(amounts)
    if center == 0:
        return all(amount == 0 for amount in amounts)
    return _median_absolute_deviation(amounts) / abs(center) <= MAX_AMOUNT_DEVIATION_FRACTION


def _members_within_amount_band(transactions: list[Transaction]) -> list[Transaction]:
    center = median([transaction.amount for transaction in transactions])
    return [
        transaction
        for transaction in transactions
        if _amount_belongs_to_contract(amount=transaction.amount, center=center)
    ]


def _amount_belongs_to_contract(amount: float, center: float) -> bool:
    # The median is robust to the very outliers we want to drop, so it stays a reliable reference even when the group
    # still contains them. Grouping already splits by direction, so amount and center share a sign; a symmetric ratio
    # band keeps genuine spikes (a multiple of the norm) while dropping unrelated small payments (a fraction of it).
    if center == 0:
        return abs(amount) <= OUTLIER_ABSOLUTE_FLOOR
    ratio = amount / center
    return 1 / MEMBER_AMOUNT_MAX_RATIO <= ratio <= MEMBER_AMOUNT_MAX_RATIO


def _find_or_create_contract(
    db_session: Session, account: Account, fingerprint: str, display_name: str
) -> tuple[Contract, bool]:
    existing_contract = db_session.scalar(
        select(Contract).where(Contract.account_id == account.id).where(Contract.fingerprint == fingerprint)
    )
    if existing_contract is not None:
        return existing_contract, False

    contract = Contract(
        account=account,
        name=display_name,
        fingerprint=fingerprint,
        source=ContractSource.DETECTED,
        created_at=utc_now(),
    )
    db_session.add(contract)
    db_session.flush()
    logger.info(f"Detected new {contract} on {account}")
    return contract, True


def recompute_contract_stats(contract: Contract) -> None:
    member_transactions = contract.members()
    dates = [transaction.date for transaction in member_transactions]

    amounts = [transaction.amount for transaction in member_transactions]
    # The current level is the median of the most recent members, so a sustained price change re-bases the contract
    # instead of leaving the new level permanently flagged against a stale full-history median. The tolerance band,
    # however, stays anchored to the full history: it reflects how much this contract genuinely fluctuates (a variable
    # salary tolerates more swing than a fixed subscription), which a short window would underestimate.
    recent_amounts = [
        transaction.amount
        for transaction in sorted(member_transactions, key=lambda transaction: transaction.date)[-RECENT_AMOUNT_WINDOW:]
    ]
    contract.median_amount = median(recent_amounts) if recent_amounts else None
    contract.amount_spread = _median_absolute_deviation(amounts) if amounts else None

    frequency, interval_days = _classify_cadence(dates)
    if contract.source == ContractSource.MANUAL and contract.frequency is not None:
        frequency = contract.frequency
        interval_days = frequency.interval_days
    contract.frequency = frequency
    contract.interval_days = interval_days
    if interval_days is not None and dates:
        contract.expected_next_date = max(dates) + datetime.timedelta(days=interval_days)
    else:
        contract.expected_next_date = None

    if contract.category in (None, TransactionCategory.UNKNOWN):
        contract.category = _dominant_category(member_transactions)
    apply_contract_category_to_members(contract)

    logger.debug(f"Recomputed stats for {contract}")


def archive_if_ended(contract: Contract) -> None:
    end_date = contract.end_date
    if contract.is_archived or end_date is None or not contract.has_ended_on(utc_now().date()):
        return
    if any(transaction.date > end_date for transaction in contract.members()):
        return
    contract.is_archived = True
    logger.info(f"Auto-archived {contract}; it ended on {contract.end_date}")


def _archive_if_long_overdue(contract: Contract) -> None:
    if contract.is_archived:
        return
    if not contract.is_overdue_on(today=utc_now().date(), grace=AUTO_ARCHIVE_OVERDUE):
        return
    contract.is_archived = True
    member_dates = [transaction.date for transaction in contract.members()]
    if contract.end_date is None and member_dates:
        contract.end_date = max(member_dates)
    logger.info(f"Auto-archived {contract}; overdue since {contract.expected_next_date}")


def apply_contract_category_to_members(contract: Contract, override_manual: bool = False) -> None:
    for transaction in contract.members():
        if transaction.category_source != CategorySource.MANUAL or override_manual:
            apply_contract_category(contract=contract, transaction=transaction)


def apply_contract_category(contract: Contract, transaction: Transaction) -> None:
    if contract.category in (None, TransactionCategory.UNKNOWN):
        return
    transaction.category = contract.category
    transaction.category_source = CategorySource.CONTRACT


def release_contract_category(transaction: Transaction, rules: CategorizationRules) -> None:
    if transaction.category_source != CategorySource.CONTRACT:
        return
    transaction.category_source = CategorySource.AUTO
    transaction.category = TransactionCategory.from_transaction(transaction=transaction, rules=rules, log_result=False)


def _median_absolute_deviation(values: list[float]) -> float:
    center = median(values)
    return median([abs(value - center) for value in values])


def _dominant_category(members: list[Transaction]) -> str | None:
    counts: dict[str, int] = defaultdict(int)
    for transaction in members:
        if transaction.category != TransactionCategory.UNKNOWN:
            counts[transaction.category] += 1
    if not counts:
        return None
    return max(counts, key=counts.__getitem__)


def _release_auto_assignments(db_session: Session, account: Account) -> None:
    rules = account.credential.user.categorization_rules
    for transaction in account.transactions:
        if transaction.contract_assignment == ContractAssignment.AUTO:
            transaction.contract_id = None
            transaction.contract_assignment = None
            release_contract_category(transaction=transaction, rules=rules)
    db_session.flush()


def _delete_empty_detected_contracts(db_session: Session, account: Account) -> None:
    for contract in list(account.contracts):
        if contract.source == ContractSource.DETECTED and not contract.members():
            logger.debug(f"Removing detected {contract} that no longer has any members")
            db_session.delete(contract)
