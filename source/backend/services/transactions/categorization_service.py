from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from source.backend.exceptions import (
    CategoryRuleNotFoundError,
    ConflictError,
    CustomCategoryNotFoundError,
    ValidationError,
)
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_share import AccountShare, ShareStatus
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.contracts.contract import Contract
from source.backend.models.notifications.notification_rule import NotificationRule
from source.backend.models.transactions.category_rule import CategoryRule
from source.backend.models.transactions.custom_category import MAX_CUSTOM_CATEGORY_NAME_LENGTH, CustomCategory
from source.backend.models.transactions.recurring_transaction import RecurringTransaction
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import (
    GROUP_VALUES,
    TRANSACTION_CATEGORY_MAPPING,
    CategoryGroup,
    TransactionCategory,
    is_known_category,
    normalize_string,
)
from source.backend.services.transactions.category_rescan import recategorize_user_transactions

logger = get_logger(__name__)

MIN_PATTERN_LENGTH = 2


@dataclass(frozen=True)
class DefaultMatcher:
    pattern: str
    category: TransactionCategory
    disabled: bool


@dataclass(frozen=True)
class VisibleCustomCategory:
    key: str
    group: CategoryGroup
    name: str
    owned: bool


def require_assignable_category(category: str | None, owner: User, allow_unknown: bool = True) -> None:
    if category is None:
        return
    if category == TransactionCategory.UNKNOWN and not allow_unknown:
        raise ValidationError("A category is required")
    if not is_known_category(category=category, custom_groups=owner.custom_category_groups):
        raise ValidationError(f"{category!r} is not a category of {owner}")


def require_category_selection(selection: Iterable[str], owner: User) -> None:
    unknown = [
        item
        for item in selection
        if item not in GROUP_VALUES and not is_known_category(category=item, custom_groups=owner.custom_category_groups)
    ]
    if unknown:
        raise ValidationError(f"Unknown categories: {', '.join(unknown)}")


def custom_category_groups_for_accounts(db_session: Session, account_ids: Iterable[int]) -> dict[str, CategoryGroup]:
    rows = db_session.execute(
        select(CustomCategory.key, CustomCategory.group)  # noqa: FKA100
        .join(Credential, onclause=Credential.user_id == CustomCategory.user_id)
        .join(Account, onclause=Account.credential_id == Credential.id)
        .where(Account.id.in_(list(account_ids)))
        .distinct()
    )
    return dict(rows.tuples().all())


def list_visible_custom_categories(db_session: Session, user: User) -> list[VisibleCustomCategory]:
    sharing_owner_ids = (
        select(Credential.user_id)
        .join(Account, onclause=Account.credential_id == Credential.id)
        .join(AccountShare, onclause=AccountShare.account_id == Account.id)
        .where(AccountShare.user_id == user.id)
        .where(AccountShare.status == ShareStatus.ACCEPTED)
    )
    custom_categories = db_session.scalars(
        select(CustomCategory)
        .where(or_(CustomCategory.user_id == user.id, CustomCategory.user_id.in_(sharing_owner_ids)))  # noqa: FKA100
        .order_by(CustomCategory.created_at)
    )
    return [
        VisibleCustomCategory(
            key=custom_category.key,
            group=custom_category.group,
            name=custom_category.name,
            owned=custom_category.user_id == user.id,
        )
        for custom_category in custom_categories
    ]


def list_default_matchers(user: User) -> list[DefaultMatcher]:
    disabled = set(user.disabled_default_matchers)
    return [
        DefaultMatcher(pattern=matcher, category=category, disabled=matcher in disabled)
        for category, matchers in TRANSACTION_CATEGORY_MAPPING.items()
        for matcher in matchers
    ]


def get_rule_for_user(user: User, rule_id: int) -> CategoryRule:
    rule = next((rule for rule in user.category_rules if rule.id == rule_id), None)
    if rule is None:
        logger.warning(f"{user} attempted to access category rule {rule_id} which is not theirs")
        raise CategoryRuleNotFoundError(f"Category rule with the ID {rule_id} not found")
    return rule


def create_rule(db_session: Session, user: User, pattern: str, category: str) -> int:
    require_assignable_category(category=category, owner=user, allow_unknown=False)
    rule = CategoryRule(pattern=_valid_pattern(user=user, pattern=pattern), category=category, created_at=utc_now())
    user.category_rules.insert(0, rule)  # noqa: FKA100
    logger.info(f"Created {rule} for {user}")
    return _recategorize_and_commit(db_session=db_session, user=user)


def update_rule(db_session: Session, user: User, rule_id: int, pattern: str, category: str) -> int:
    rule = get_rule_for_user(user=user, rule_id=rule_id)
    rule.pattern = _valid_pattern(user=user, pattern=pattern, rule_id=rule_id)
    require_assignable_category(category=category, owner=user, allow_unknown=False)
    rule.category = category
    logger.info(f"Updated {rule} for {user}")
    return _recategorize_and_commit(db_session=db_session, user=user)


def delete_rule(db_session: Session, user: User, rule_id: int) -> int:
    rule = get_rule_for_user(user=user, rule_id=rule_id)
    user.category_rules.remove(rule)
    logger.info(f"Deleted {rule} of {user}")
    return _recategorize_and_commit(db_session=db_session, user=user)


def set_default_matcher_disabled(db_session: Session, user: User, pattern: str, disabled: bool) -> int:
    if not any(pattern in matchers for matchers in TRANSACTION_CATEGORY_MAPPING.values()):
        raise ValidationError(f"{pattern!r} is not a default matcher")
    others = [matcher for matcher in user.disabled_default_matchers if matcher != pattern]
    user.disabled_default_matchers = sorted([*others, pattern]) if disabled else others
    logger.info(f"{'Disabled' if disabled else 'Enabled'} the default matcher {pattern!r} for {user}")
    return _recategorize_and_commit(db_session=db_session, user=user)


def _valid_pattern(user: User, pattern: str, rule_id: int | None = None) -> str:
    normalized = normalize_string(pattern)
    if len(normalized) < MIN_PATTERN_LENGTH:
        raise ValidationError(f"A rule pattern needs at least {MIN_PATTERN_LENGTH} characters")
    if any(rule.pattern == normalized and rule.id != rule_id for rule in user.category_rules):
        raise ConflictError(f"{user} already has a rule for {normalized!r}")
    return normalized


def get_custom_category_for_user(user: User, key: str) -> CustomCategory:
    custom_category = next((custom for custom in user.custom_categories if custom.key == key), None)
    if custom_category is None:
        logger.warning(f"{user} attempted to access custom category {key} which is not theirs")
        raise CustomCategoryNotFoundError(f"Custom category {key} not found")
    return custom_category


def create_custom_category(db_session: Session, user: User, group: CategoryGroup, name: str) -> CustomCategory:
    custom_category = CustomCategory(
        group=group, name=_valid_custom_category_name(user=user, group=group, name=name), created_at=utc_now()
    )
    user.custom_categories.append(custom_category)
    db_session.commit()
    logger.info(f"Created {custom_category} for {user}")
    return custom_category


def update_custom_category(db_session: Session, user: User, key: str, group: CategoryGroup, name: str) -> int:
    custom_category = get_custom_category_for_user(user=user, key=key)
    custom_category.name = _valid_custom_category_name(user=user, group=group, name=name, key=key)
    custom_category.group = group
    logger.info(f"Updated {custom_category} of {user}")
    return _recategorize_and_commit(db_session=db_session, user=user)


def delete_custom_category(db_session: Session, user: User, key: str) -> int:
    custom_category = get_custom_category_for_user(user=user, key=key)
    fallback = TransactionCategory.UNKNOWN.value
    owned_accounts = select(Account.id).join(Credential).where(Credential.user_id == user.id)
    for model in (Transaction, RecurringTransaction, Contract):
        db_session.execute(
            update(model)
            .where(model.category == key)  # type: ignore[attr-defined]
            .where(model.account_id.in_(owned_accounts))  # type: ignore[attr-defined]
            .values(category=fallback)
            .execution_options(synchronize_session="fetch")
        )
    for rule in [rule for rule in user.category_rules if rule.category == key]:
        user.category_rules.remove(rule)
    for notification_rule in db_session.scalars(select(NotificationRule).where(NotificationRule.user_id == user.id)):
        if key in notification_rule.categories:
            notification_rule.categories = [category for category in notification_rule.categories if category != key]
    user.custom_categories.remove(custom_category)
    logger.info(f"Deleted {custom_category} of {user}; its transactions fell back to {fallback}")
    return _recategorize_and_commit(db_session=db_session, user=user)


def _valid_custom_category_name(user: User, group: CategoryGroup, name: str, key: str | None = None) -> str:
    stripped = " ".join(name.split())
    if not stripped or len(stripped) > MAX_CUSTOM_CATEGORY_NAME_LENGTH:
        raise ValidationError(f"A category name needs 1 to {MAX_CUSTOM_CATEGORY_NAME_LENGTH} characters")
    if any(
        custom.group == group and custom.name.casefold() == stripped.casefold() and custom.key != key
        for custom in user.custom_categories
    ):
        raise ConflictError(f"{user} already has a category {stripped!r} in {group.value}")
    return stripped


def _recategorize_and_commit(db_session: Session, user: User) -> int:
    db_session.flush()
    # The relationships keep their in-memory order and state, so reload them before deriving the rules
    db_session.expire(instance=user, attribute_names=["category_rules", "custom_categories"])
    recategorized = recategorize_user_transactions(db_session=db_session, user=user)
    db_session.commit()
    return recategorized
