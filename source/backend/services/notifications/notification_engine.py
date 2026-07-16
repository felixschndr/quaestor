import datetime
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.helpers import format_amount, utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.contracts.contract import Contract
from source.backend.models.notifications.notification_rule import (
    BalanceDirection,
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

logger = get_logger(__name__)

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
            if account.id not in rule.account_ids:
                continue

            rule_notifications = _notifications_for_rule(
                rule=rule,
                account=account,
                new_transactions=new_transactions,
                booked_expected_transactions=booked_expected_transactions,
                balance_before=before.balance,
                language=language,
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
    covered_account_ids = {account_id for rule in overdue_rules for account_id in rule.account_ids}

    contracts = db_session.scalars(
        select(Contract)
        .join(Account, onclause=Contract.account_id == Account.id)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user.id)
    ).all()

    notifications: list[Notification] = []
    for contract in contracts:
        if not contract.is_overdue_on(today):
            # Payment arrived: reset so a future overdue episode notifies again.
            contract.overdue_notified_at = None
            continue
        if contract.overdue_notified_at is not None:
            continue  # Already notified for this overdue episode.
        if contract.account_id not in covered_account_ids:
            continue  # No enabled rule covers this account

        rule = next(rule for rule in overdue_rules if contract.account_id in rule.account_ids)
        notifications.append(_build_overdue_notification(rule=rule, contract=contract, language=user.language))
        contract.overdue_notified_at = utc_now()
        logger.info(f"{contract} is overdue (expected {contract.expected_next_date}); queued notification")

    return notifications


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
) -> list[Notification]:
    # Literal keys, not f-strings: scripts/checks/check_i18n.py greps for them.
    transaction_message_keys = {
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
    if rule.trigger in transaction_message_keys:
        keys = transaction_message_keys[rule.trigger]
        is_expected = rule.trigger is NotificationTrigger.EXPECTED_TRANSACTION
        candidates = booked_expected_transactions if is_expected else new_transactions
        notifications = []
        for transaction in candidates:
            if not is_expected and not _transaction_matches(rule=rule, transaction=transaction):
                continue
            if rule.include_content:
                body = notification_messages.translate(
                    language,
                    key=keys["body"],
                    account=account.display_label,
                    amount=format_amount(transaction.amount),
                )
                if transaction.other_party:
                    body += f" · {transaction.other_party}"
            else:
                body = notification_messages.translate(
                    language, key=keys["body_minimal"], account=account.display_label
                )
            notifications.append(
                _build_notification(
                    rule=rule,
                    account=account,
                    default_title=notification_messages.translate(language, key=keys["title"]),
                    body=body,
                )
            )
        logger.debug(f"{rule}: matched {len(notifications)}/{len(candidates)} transaction(s) on {account}")
        return notifications

    if rule.trigger is NotificationTrigger.BALANCE_THRESHOLD:
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
                amount=format_amount(account.balance),
                threshold=format_amount(rule.threshold),
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

    return []


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
    rule: NotificationRule, account: Account, default_title: str, body: str, tag: str | None = None
) -> Notification:
    return Notification(
        title=rule.name or default_title,
        body=body,
        url=f"/account/{account.id}",
        tag=tag,  # Collapse repeated balance alerts for the same account/rule.
    )
