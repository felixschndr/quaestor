import datetime
from dataclasses import dataclass
from urllib.parse import urlencode

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.helpers import format_amount, utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.contracts.contract import (
    DUPLICATE_WINDOW_DAYS,
    OVERDUE_GRACE_DAYS,
    SHORTFALL_LOOKAHEAD_DAYS,
    Contract,
)
from source.backend.models.contracts.contract_assignment import ContractAssignment
from source.backend.models.notifications.notification_rule import (
    BalanceDirection,
    DigestPeriod,
    NotificationRule,
    NotificationTrigger,
)
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.notifications import (
    notification_messages,
    notification_rule_service,
    notification_service,
)
from source.backend.services.notifications.notification_service import Notification
from source.backend.services.transactions import statistics_service

logger = get_logger(__name__)

AMOUNT_TOLERANCE = 0.01  # Two amounts less than a cent apart are the same amount

_ALL_CATEGORIES = [category.value for category in TransactionCategory]
_ALL_TYPES = [transaction_type.value for transaction_type in TransactionType]


@dataclass
class _AccountState:
    balance: float
    booked_transaction_ids: set[int | None]
    expected_transactions: list[Transaction]


@dataclass
class SyncSnapshot:
    # The per-account state captured before a credential sync, used to diff afterwards
    accounts: dict[int, _AccountState]


def capture_sync_snapshot(credential: Credential) -> SyncSnapshot:
    accounts = {
        account.id: _AccountState(
            balance=account.balance,
            booked_transaction_ids={
                transaction.id
                for transaction in account.transactions
                if transaction.id is not None and not transaction.expected and not transaction.pending
            },
            expected_transactions=[transaction for transaction in account.transactions if transaction.expected],
        )
        for account in credential.accounts
    }
    logger.debug(f"Captured pre-sync snapshot for {credential} ({len(accounts)} account(s))")
    return SyncSnapshot(accounts=accounts)


def _rule_applies_to_account(rule: NotificationRule, account_id: int) -> bool:
    return not rule.account_ids or account_id in rule.account_ids


def collect_notifications(db_session: Session, credential: Credential, snapshot: SyncSnapshot) -> list[Notification]:
    all_rules = notification_rule_service.list_rules(db_session=db_session, user=credential.user)
    rules = [rule for rule in all_rules if rule.enabled]
    if not rules:
        logger.debug(
            f"No enabled notification rules for {credential.user} "
            f"({len(all_rules)} total, none enabled); skipping evaluation of {credential}"
        )
        return []
    logger.debug(f"Evaluating {len(rules)} enabled notification rule(s) for {credential.user} after {credential}")

    language = credential.user.language
    currency = credential.user.currency
    notifications: list[Notification] = []
    for account in credential.accounts:
        before = snapshot.accounts.get(account.id)
        if before is None:
            # Account first seen during this sync
            logger.debug(f"{account} first seen during this sync; skipping its rule evaluation")
            continue

        new_transactions = [
            transaction
            for transaction in account.transactions
            if not transaction.expected
            and not transaction.pending
            and (transaction.id is None or transaction.id not in before.booked_transaction_ids)
        ]
        still_present_transactions = set(account.transactions)
        booked_expected_transactions = [
            transaction for transaction in before.expected_transactions if transaction not in still_present_transactions
        ]
        logger.debug(
            f"{account}: {len(new_transactions)} new transaction(s), "
            f"{len(booked_expected_transactions)} expected booked"
        )

        for rule in rules:
            if not _rule_applies_to_account(rule=rule, account_id=account.id):
                continue

            rule_notifications = _notifications_for_rule(
                rule=rule,
                account=account,
                new_transactions=new_transactions,
                booked_expected_transactions=booked_expected_transactions,
                balance_before=before.balance,
                language=language,
                currency=currency,
                today=datetime.date.today(),
            )
            if rule_notifications:
                logger.info(f"{rule} matched on {account}: {len(rule_notifications)} notification(s)")
            notifications.extend(rule_notifications)

    if notifications:
        logger.info(f"Collected {len(notifications)} notification(s) from {credential}")
    else:
        logger.debug(f"No notifications triggered from {credential}")
    return notifications


def evaluate_overdue_contracts(db_session: Session, today: datetime.date) -> None:
    users = db_session.scalars(select(User)).all()
    logger.info(f"Evaluating overdue contracts for {len(users)} user(s)")
    for user in users:
        notifications = _collect_overdue_notifications(db_session=db_session, user=user, today=today)
        db_session.commit()
        dispatch(db_session=db_session, user=user, notifications=notifications)


def _collect_overdue_notifications(db_session: Session, user: User, today: datetime.date) -> list[Notification]:
    overdue_rules = [
        rule
        for rule in notification_rule_service.list_rules(db_session=db_session, user=user)
        if rule.enabled and rule.trigger is NotificationTrigger.CONTRACT_OVERDUE
    ]
    contracts = db_session.scalars(
        select(Contract)
        .join(Account, onclause=Contract.account_id == Account.id)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
    ).all()

    notifications: list[Notification] = []
    for contract in contracts:
        rule = next(
            (rule for rule in overdue_rules if _rule_applies_to_account(rule=rule, account_id=contract.account_id)),
            None,
        )
        grace_days = rule.days if rule is not None and rule.days is not None else OVERDUE_GRACE_DAYS
        if not contract.is_overdue_on(today=today, grace_days=grace_days):
            if contract.overdue_notified_at is not None:
                # Payment arrived: reset so a future overdue episode notifies again.
                contract.overdue_notified_at = None
            continue
        if contract.overdue_notified_at is not None:
            continue  # Already notified for this overdue episode.
        if rule is None:
            continue  # No enabled rule covers this account

        notifications.append(_build_overdue_notification(rule=rule, contract=contract, language=user.language))
        contract.overdue_notified_at = utc_now()
        logger.info(f"{contract} is overdue (expected {contract.expected_next_date}); queued notification")

    return notifications


def evaluate_digests(db_session: Session, today: datetime.date) -> None:
    users = db_session.scalars(select(User)).all()
    logger.info(f"Evaluating digest rules for {len(users)} user(s)")
    for user in users:
        digest_rules = [
            rule
            for rule in notification_rule_service.list_rules(db_session=db_session, user=user)
            if rule.enabled and rule.trigger is NotificationTrigger.DIGEST
        ]
        notifications = [
            notification
            for rule in digest_rules
            if (notification := _digest_notification(db_session=db_session, rule=rule, user=user, today=today))
        ]
        dispatch(db_session=db_session, user=user, notifications=notifications)


def _digest_notification(
    db_session: Session, rule: NotificationRule, user: User, today: datetime.date
) -> Notification | None:
    ranges = _digest_ranges(period=rule.period, today=today)
    if ranges is None:
        return None
    (start, end), (previous_start, previous_end) = ranges

    account_ids = rule.account_ids or [account.id for credential in user.credentials for account in credential.accounts]
    current = statistics_service.range_summary(
        db_session=db_session, user=user, account_ids=account_ids, date_from=start, date_to=end
    )
    previous = statistics_service.range_summary(
        db_session=db_session, user=user, account_ids=account_ids, date_from=previous_start, date_to=previous_end
    )
    logger.info(f"{rule}: digest for {start}..{end}: {current}")

    keys = _MESSAGE_KEYS[rule.period]
    language = user.language
    currency = user.currency
    if not rule.include_content:
        return Notification(
            title=rule.name or notification_messages.translate(language, key=keys["title_minimal"]),
            body=notification_messages.translate(language, key="digest.body_minimal"),
            url=_digest_url(start=start, end=end),
            tag=f"digest-{rule.id}",
        )

    title = notification_messages.translate(
        language,
        key=keys["title"],
        net=format_amount(round(number=current.income - current.expenses, ndigits=2), currency=currency),
    )
    comparison = _digest_comparison(current=current, previous=previous, keys=keys, language=language, currency=currency)
    return Notification(
        title=rule.name or (f"{title} ({comparison})" if comparison else title),
        body=notification_messages.translate(
            language,
            key="digest.body",
            expenses=format_amount(current.expenses, currency=currency),
            income=format_amount(current.income, currency=currency),
            count=current.count,
        ),
        url=_digest_url(start=start, end=end),
        tag=f"digest-{rule.id}",
    )


def _digest_comparison(
    current: statistics_service.RangeSummary,
    previous: statistics_service.RangeSummary,
    keys: dict[str, str],
    language: str,
    currency: str,
) -> str | None:
    if previous.expenses <= 0:
        return None  # Nothing to compare against.
    difference = current.expenses - previous.expenses
    return notification_messages.translate(
        language,
        key=keys["more"] if difference > 0 else keys["less"],
        percent=round(number=abs(difference) / previous.expenses * 100),
        amount=format_amount(abs(difference), currency=currency),
    )


def _digest_url(start: datetime.date, end: datetime.date) -> str:
    return f"/stats?date_from={start.isoformat()}&date_to={end.isoformat()}"


def _digest_ranges(
    period: DigestPeriod | None, today: datetime.date
) -> tuple[tuple[datetime.date, datetime.date], tuple[datetime.date, datetime.date]] | None:
    end = today - datetime.timedelta(days=1)
    if period is DigestPeriod.WEEKLY and today.weekday() == 0:
        start = end - datetime.timedelta(days=6)
        return (start, end), (start - datetime.timedelta(days=7), start - datetime.timedelta(days=1))
    if period is DigestPeriod.MONTHLY and today.day == 1:
        start = end.replace(day=1)
        previous_end = start - datetime.timedelta(days=1)
        return (start, end), (previous_end.replace(day=1), previous_end)
    return None


def _build_overdue_notification(rule: NotificationRule, contract: Contract, language: str) -> Notification:
    account = contract.account
    if rule.include_content:
        body = notification_messages.translate(
            language,
            key="contract_overdue.body",
            account=account.display_label,
            name=contract.name,
            date=contract.expected_next_date.isoformat() if contract.expected_next_date else "",
        )
    else:
        body = notification_messages.translate(
            language, key="contract_overdue.body_minimal", account=account.display_label
        )
    return Notification(
        title=rule.name or notification_messages.translate(language, key="contract_overdue.title"),
        body=body,
        url=f"/contracts/{contract.id}",
        tag=f"contract-overdue-{contract.id}",
    )


def dispatch(db_session: Session, user: User, notifications: list[Notification]) -> None:
    if not notifications:
        return

    logger.info(f"Dispatching {len(notifications)} notification(s) to {user}")
    for notification in notifications:
        logger.debug(f"Dispatching to {user}: {notification}")
        notification_service.notify_user(db_session=db_session, user=user, notification=notification)


def _notifications_for_rule(
    rule: NotificationRule,
    account: Account,
    new_transactions: list[Transaction],
    booked_expected_transactions: list[Transaction],
    balance_before: float,
    language: str,
    currency: str,
    today: datetime.date,
) -> list[Notification]:
    if rule.trigger in _MESSAGE_KEYS:
        is_expected = rule.trigger is NotificationTrigger.EXPECTED_TRANSACTION
        return _transaction_notifications(
            rule=rule,
            account=account,
            candidates=booked_expected_transactions if is_expected else new_transactions,
            match_criteria=not is_expected,
            language=language,
            currency=currency,
            bookings=new_transactions if is_expected else None,
        )

    if rule.trigger is NotificationTrigger.BALANCE_THRESHOLD:
        return _balance_threshold_notifications(
            rule=rule, account=account, balance_before=balance_before, language=language, currency=currency
        )

    if rule.trigger is NotificationTrigger.DUPLICATE_TRANSACTION:
        return _duplicate_notifications(
            rule=rule, account=account, new_transactions=new_transactions, language=language, currency=currency
        )

    if rule.trigger is NotificationTrigger.CONTRACT_AMOUNT_INCREASED:
        return _contract_amount_notifications(
            rule=rule, account=account, new_transactions=new_transactions, language=language, currency=currency
        )

    if rule.trigger is NotificationTrigger.UPCOMING_SHORTFALL:
        return _upcoming_shortfall_notifications(
            rule=rule,
            account=account,
            balance_before=balance_before,
            language=language,
            currency=currency,
            today=today,
        )

    return []


# Literal keys, not f-strings: scripts/checks/check_i18n.py greps for them.
_MESSAGE_KEYS = {
    DigestPeriod.WEEKLY: {
        "title": "digest.weekly.title",
        "title_minimal": "digest.weekly.title_minimal",
        "more": "digest.weekly.more",
        "less": "digest.weekly.less",
    },
    DigestPeriod.MONTHLY: {
        "title": "digest.monthly.title",
        "title_minimal": "digest.monthly.title_minimal",
        "more": "digest.monthly.more",
        "less": "digest.monthly.less",
    },
    NotificationTrigger.EXPECTED_TRANSACTION: {
        "title": "expected_transaction.title",
        "body": "expected_transaction.body",
        "body_minimal": "expected_transaction.body_minimal",
    },
    NotificationTrigger.TRANSACTION: {
        "title": "transaction.title",
        "body": "transaction.body",
        "body_minimal": "transaction.body_minimal",
    },
}


def _transaction_notifications(
    rule: NotificationRule,
    account: Account,
    candidates: list[Transaction],
    match_criteria: bool,
    language: str,
    currency: str,
    bookings: list[Transaction] | None = None,
) -> list[Notification]:
    keys = _MESSAGE_KEYS[rule.trigger]
    notifications = []
    for transaction in candidates:
        if match_criteria and not _transaction_matches(rule=rule, transaction=transaction):
            continue
        if rule.include_content:
            body = notification_messages.translate(
                language,
                key=keys["body"],
                account=account.display_label,
                amount=format_amount(transaction.amount, currency=currency),
            )
            if transaction.other_party:
                body += f" · {transaction.other_party}"
        else:
            body = notification_messages.translate(language, key=keys["body_minimal"], account=account.display_label)
        notifications.append(
            _build_notification(
                rule=rule,
                account=account,
                default_title=notification_messages.translate(language, key=keys["title"]),
                body=body,
                url=_transaction_url(
                    account=account, transaction=_booking_for(transaction=transaction, bookings=bookings)
                ),
            )
        )
    logger.debug(f"{rule}: matched {len(notifications)}/{len(candidates)} transaction(s) on {account}")
    return notifications


def _balance_threshold_notifications(
    rule: NotificationRule, account: Account, balance_before: float, language: str, currency: str
) -> list[Notification]:
    if rule.threshold is None:
        return []

    if rule.direction is BalanceDirection.ABOVE:
        crossed = balance_before <= rule.threshold < account.balance
        title_key = "balance_above.title"
        body_key = "balance_above.body"
    else:
        crossed = balance_before >= rule.threshold > account.balance
        title_key = "balance_below.title"
        body_key = "balance_below.body"
    logger.debug(f"Evaluated {rule}: balance was {balance_before:.2f} before sync (crossed={crossed})")
    if not crossed:
        return []

    if rule.include_content:
        body = notification_messages.translate(
            language,
            key=body_key,
            account=account.display_label,
            amount=format_amount(account.balance, currency=currency),
            threshold=format_amount(rule.threshold, currency=currency),
        )
    else:
        body = notification_messages.translate(
            language, key="balance_threshold.body_minimal", account=account.display_label
        )
    return [
        _build_notification(
            rule=rule,
            account=account,
            default_title=notification_messages.translate(language, key=title_key),
            body=body,
            tag=f"balance-{rule.id}-{account.id}",
        )
    ]


def _upcoming_shortfall_notifications(
    rule: NotificationRule, account: Account, balance_before: float, language: str, currency: str, today: datetime.date
) -> list[Notification]:
    lookahead = datetime.timedelta(days=rule.days or SHORTFALL_LOOKAHEAD_DAYS)
    due = _upcoming_fixed_costs(account=account, today=today, lookahead=lookahead)
    crossed = due > 0 and balance_before >= due > account.balance
    logger.debug(
        f"Evaluated {rule} on {account}: {format_amount(due)} due within {lookahead.days} days, "
        f"balance {balance_before:.2f} -> {account.balance:.2f} (crossed={crossed})"
    )
    if not crossed:
        return []

    if rule.include_content:
        body = notification_messages.translate(
            language,
            key="upcoming_shortfall.body",
            account=account.display_label,
            amount=format_amount(account.balance, currency=currency),
            due=format_amount(due, currency=currency),
            days=lookahead.days,
        )
    else:
        body = notification_messages.translate(
            language, key="upcoming_shortfall.body_minimal", account=account.display_label
        )
    return [
        _build_notification(
            rule=rule,
            account=account,
            default_title=notification_messages.translate(language, key="upcoming_shortfall.title"),
            body=body,
            tag=f"shortfall-{rule.id}-{account.id}",
        )
    ]


def _duplicate_notifications(
    rule: NotificationRule, account: Account, new_transactions: list[Transaction], language: str, currency: str
) -> list[Notification]:
    window = datetime.timedelta(days=rule.days or DUPLICATE_WINDOW_DAYS)
    new = set(new_transactions)
    earlier = [
        transaction
        for transaction in account.transactions
        if not transaction.expected and not transaction.pending and transaction not in new
    ]

    notifications = []
    for transaction in new_transactions:
        twin = next(
            (other for other in earlier if _is_duplicate(candidate=other, transaction=transaction, window=window)), None
        )
        earlier.append(transaction)
        if twin is None:
            continue

        if rule.include_content:
            body = notification_messages.translate(
                language,
                key="duplicate_transaction.body",
                account=account.display_label,
                amount=format_amount(transaction.amount, currency=currency),
                other_party=transaction.other_party or "",
                days=window.days,
            )
        else:
            body = notification_messages.translate(
                language, key="duplicate_transaction.body_minimal", account=account.display_label
            )
        logger.info(f"{transaction} looks like a duplicate of {twin}")
        notifications.append(
            _build_notification(
                rule=rule,
                account=account,
                default_title=notification_messages.translate(language, key="duplicate_transaction.title"),
                body=body,
                url=_search_url(
                    account=account,
                    amount=transaction.amount,
                    date_from=min(twin.date, transaction.date),
                    date_to=max(twin.date, transaction.date),
                    text=transaction.other_party,
                ),
            )
        )
    return notifications


def _is_duplicate(candidate: Transaction, transaction: Transaction, window: datetime.timedelta) -> bool:
    # Without a counterparty there is nothing to tell a duplicate from an ordinary repeat purchase.
    other_party = (transaction.other_party or "").strip().lower()
    if not other_party or other_party != (candidate.other_party or "").strip().lower():
        return False
    if abs(candidate.amount - transaction.amount) >= AMOUNT_TOLERANCE:
        return False
    return abs(candidate.date - transaction.date) <= window


def _contract_amount_notifications(
    rule: NotificationRule, account: Account, new_transactions: list[Transaction], language: str, currency: str
) -> list[Notification]:
    notifications = []
    for transaction in new_transactions:
        contract = transaction.contract
        if contract is None or transaction.contract_assignment is ContractAssignment.EXCLUDED:
            continue
        if contract.median_amount is None or abs(transaction.amount) <= abs(contract.median_amount):
            continue
        if not contract.is_outlier(transaction):
            continue

        if rule.include_content:
            body = notification_messages.translate(
                language,
                key="contract_amount_increased.body",
                account=account.display_label,
                name=contract.name,
                amount=format_amount(transaction.amount, currency=currency),
                previous=format_amount(contract.median_amount, currency=currency),
            )
        else:
            body = notification_messages.translate(
                language, key="contract_amount_increased.body_minimal", account=account.display_label
            )
        logger.info(f"{contract} charged {transaction.amount} against a median of {contract.median_amount}")
        notifications.append(
            Notification(
                title=rule.name or notification_messages.translate(language, key="contract_amount_increased.title"),
                body=body,
                url=f"/contracts/{contract.id}",
                tag=f"contract-amount-{contract.id}",
            )
        )
    return notifications


def _upcoming_fixed_costs(account: Account, today: datetime.date, lookahead: datetime.timedelta) -> float:
    horizon = today + lookahead
    total = 0.0
    for contract in account.contracts:
        amount = contract.median_amount
        due_date = contract.expected_next_date
        if amount is None or amount >= 0 or due_date is None:
            continue
        if today <= due_date <= horizon:
            total -= amount
    return total


def _transaction_matches(rule: NotificationRule, transaction: Transaction) -> bool:
    if rule.other_party_contains:
        needle = rule.other_party_contains.strip().lower()
        if needle not in (transaction.other_party or "").lower():
            return False

    if not _selection_matches(value=transaction.category.value, selected=rule.categories, all_values=_ALL_CATEGORIES):
        return False

    type_value = transaction.transaction_type.value if transaction.transaction_type is not None else None
    if not _selection_matches(value=type_value, selected=rule.types, all_values=_ALL_TYPES):
        return False

    if rule.min_amount is not None and transaction.amount < rule.min_amount:
        return False
    if rule.max_amount is not None and transaction.amount > rule.max_amount:
        return False
    return True


def _selection_matches(value: str | None, selected: list[str], all_values: list[str]) -> bool:
    # No selection matches nothing; selecting everything is a wildcard (also matches an unknown/None value).
    if not selected:
        return False
    if set(selected) >= set(all_values):
        return True
    return value is not None and value in selected


def _build_notification(
    rule: NotificationRule,
    account: Account,
    default_title: str,
    body: str,
    tag: str | None = None,
    url: str | None = None,
) -> Notification:
    return Notification(
        title=rule.name or default_title,
        body=body,
        url=url or f"/account/{account.id}",
        tag=tag,  # Collapse repeated balance alerts for the same account/rule.
    )


def _booking_for(transaction: Transaction, bookings: list[Transaction] | None) -> Transaction | None:
    # An expected transaction is deleted once a booking matches it, so link to that booking instead.
    # Without a match there is no row left to link to.
    if bookings is None:
        return transaction
    return next((booking for booking in bookings if booking.matched_expected_id == transaction.id), None)


def _transaction_url(account: Account, transaction: Transaction | None) -> str:
    # A transaction that was never flushed has no id to link to, so fall back to its account.
    if transaction is None or transaction.id is None:
        return f"/account/{account.id}"
    return f"/account/{account.id}/transactions/{transaction.id}"


def _search_url(
    account: Account,
    amount: float,
    date_from: datetime.date,
    date_to: datetime.date | None = None,
    text: str | None = None,
) -> str:
    query = {
        "account_ids": str(account.id),
        "amount_from": f"{amount - AMOUNT_TOLERANCE:.2f}",
        "amount_to": f"{amount + AMOUNT_TOLERANCE:.2f}",
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat() if date_to else None,
        "text": text or None,
    }
    parameters = urlencode({key: value for key, value in query.items() if value is not None})
    return f"/account/{account.id}/search?{parameters}"
