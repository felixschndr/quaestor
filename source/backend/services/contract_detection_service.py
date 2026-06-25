import datetime
from collections import defaultdict
from statistics import median

from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.contract import Contract
from source.backend.models.contract_assignment import ContractAssignment
from source.backend.models.contract_frequency import ContractFrequency
from source.backend.models.contract_source import ContractSource
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from source.backend.models.user import User
from source.backend.services.contract_aggregators import compute_fingerprint
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

MIN_OCCURRENCES = 3
INTERVAL_TOLERANCE = 0.25

ELIGIBLE_TRANSACTION_TYPES = frozenset(
    {
        TransactionType.INCOMING,
        TransactionType.OUTGOING,
        TransactionType.DEPOSIT,
        TransactionType.REMOVAL,
    }
)

BLACKLISTED_CATEGORIES = frozenset(
    {
        TransactionCategory.SUPERMARKET,
        TransactionCategory.DRUGSTORE,
        TransactionCategory.RESTAURANTS,
        TransactionCategory.CLOTHING,
        TransactionCategory.GIFTS,
        TransactionCategory.REIMBURSEMENT,
    }
)


def detect_contracts_for_user(db_session: Session, user: User) -> None:
    accounts = db_session.scalars(
        select(Account)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
    ).all()
    logger.debug(f"Running contract detection for {user} across {len(accounts)} account(s)")
    for account in accounts:
        detect_contracts_for_account(db_session=db_session, account=account)


def detect_contracts_for_account(db_session: Session, account: Account) -> int:
    _release_auto_assignments(db_session=db_session, account=account)
    eligible = _get_eligible_transactions(db_session=db_session, account=account)
    groups = _group_by_fingerprint(eligible)
    logger.debug(
        f"Contract detection on {account}: {len(eligible)} eligible transaction(s) in {len(groups)} fingerprint group(s)"
    )

    detected = 0
    for (fingerprint, display_name), transactions in groups.items():
        frequency, interval_days = _classify_cadence([transaction.date for transaction in transactions])
        if frequency is None:
            logger.debug(
                f"Group '{display_name}' ({fingerprint}) with {len(transactions)} transaction(s) is not recurring"
            )
            continue

        contract = _find_or_create_contract(
            db_session=db_session, account=account, fingerprint=fingerprint, display_name=display_name
        )
        for transaction in transactions:
            transaction.contract_id = contract.id
            transaction.contract_assignment = ContractAssignment.AUTO

        detected += 1
        logger.debug(
            f"Linked {len(transactions)} transaction(s) to {contract} " f"({frequency.value}, ~{interval_days}d)"
        )

    db_session.flush()
    for contract in account.contracts:
        recompute_contract_stats(contract)
    _delete_empty_detected_contracts(db_session=db_session, account=account)
    db_session.flush()

    logger.info(f"Contract detection on {account}: {detected} recurring contract(s) detected")
    return detected


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


def _group_by_fingerprint(transactions: list[Transaction]) -> dict[tuple[str, str], list[Transaction]]:
    groups: dict[tuple[str, str], list[Transaction]] = defaultdict(list)
    for transaction in transactions:
        if _is_transaction_blacklisted_for_automatic_contract_detection(transaction):
            logger.debug(f"Skipping blacklisted other party '{transaction.other_party}' for contract detection")
            continue
        fingerprint = compute_fingerprint(transaction)
        if fingerprint is None:
            continue

        direction = "in" if transaction.amount >= 0 else "out"
        key = f"{fingerprint.key}:{direction}"
        groups[(key, fingerprint.display_name)].append(transaction)

    return groups


def _is_transaction_blacklisted_for_automatic_contract_detection(transaction: Transaction) -> bool:
    return TransactionCategory.from_transaction(transaction=transaction) in BLACKLISTED_CATEGORIES


def _classify_cadence(dates: list[datetime.date]) -> tuple[ContractFrequency | None, int | None]:
    if len(dates) < MIN_OCCURRENCES:
        return None, None

    ordered = sorted(dates)
    gaps = [(later - earlier).days for earlier, later in zip(ordered, ordered[1:]) if later != earlier]
    if len(gaps) < MIN_OCCURRENCES - 1:
        return None, None

    median_gap = median(gaps)
    best_frequency: ContractFrequency | None = None
    best_deviation = INTERVAL_TOLERANCE
    for frequency in ContractFrequency:
        deviation = abs(median_gap - frequency.interval_days) / frequency.interval_days
        if deviation <= best_deviation:
            best_frequency = frequency
            best_deviation = deviation
    if best_frequency is None:
        return None, None
    return best_frequency, round(median_gap)


def _find_or_create_contract(db_session: Session, account: Account, fingerprint: str, display_name: str) -> Contract:
    existing_contract = db_session.scalar(
        select(Contract).where(Contract.account_id == account.id).where(Contract.fingerprint == fingerprint)
    )
    if existing_contract is not None:
        return existing_contract

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
    return contract


def recompute_contract_stats(contract: Contract) -> None:
    member_transactions = contract.members()
    amounts = [transaction.amount for transaction in member_transactions]
    dates = [transaction.date for transaction in member_transactions]

    contract.median_amount = median(amounts) if amounts else None
    contract.amount_spread = _median_absolute_deviation(amounts) if amounts else None
    frequency, interval_days = _classify_cadence(dates)
    contract.frequency = frequency
    contract.interval_days = interval_days
    if interval_days is not None and dates:
        contract.expected_next_date = max(dates) + datetime.timedelta(days=interval_days)
    else:
        contract.expected_next_date = None

    if contract.category in (None, TransactionCategory.UNKNOWN):
        contract.category = _dominant_category(member_transactions)

    logger.debug(f"Recomputed stats for {contract}")


def _median_absolute_deviation(values: list[float]) -> float:
    center = median(values)
    return median([abs(value - center) for value in values])


def _dominant_category(members: list[Transaction]) -> TransactionCategory | None:
    counts: dict[TransactionCategory, int] = defaultdict(int)
    for transaction in members:
        if transaction.category != TransactionCategory.UNKNOWN:
            counts[transaction.category] += 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def _release_auto_assignments(db_session: Session, account: Account) -> None:
    for transaction in account.transactions:
        if transaction.contract_assignment == ContractAssignment.AUTO:
            transaction.contract_id = None
            transaction.contract_assignment = None
    db_session.flush()


def _delete_empty_detected_contracts(db_session: Session, account: Account) -> None:
    for contract in list(account.contracts):
        if contract.source == ContractSource.DETECTED and not contract.members():
            logger.debug(f"Removing detected {contract} that no longer has any members")
            db_session.delete(contract)
