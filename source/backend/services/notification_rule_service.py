from source.backend.exceptions import NotificationRuleNotFoundError
from source.backend.helpers import apply_fields
from source.backend.logging_utils import get_logger
from source.backend.models.base import snapshot_columns
from source.backend.models.notification_rule import NotificationRule
from source.backend.models.user import User
from source.backend.services import account_service
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


def list_rules(db_session: Session, user: User) -> list[NotificationRule]:
    rules = list(db_session.scalars(select(NotificationRule).where(NotificationRule.user_id == user.id)))
    logger.debug(f"Found {len(rules)} notification rule(s) for {user}")
    return rules


def get_rule_for_user(db_session: Session, rule_id: int, user: User) -> NotificationRule:
    rule = db_session.get(entity=NotificationRule, ident=rule_id)
    if rule is None or rule.user_id != user.id:
        logger.warning(f"{user} attempted to access notification rule {rule_id} which is not theirs")
        raise NotificationRuleNotFoundError(f"Notification rule with the ID {rule_id} not found")
    return rule


def create_rule(db_session: Session, user: User, fields: dict) -> NotificationRule:
    account_service.resolve_owned_account_ids(db_session=db_session, user=user, account_ids=fields["account_ids"])
    rule = NotificationRule(user_id=user.id, **fields)
    db_session.add(rule)
    db_session.commit()
    logger.info(f"Created {rule.trigger.value} notification rule {rule.id} for {user}")
    return rule


def update_rule(db_session: Session, user: User, rule: NotificationRule, fields: dict) -> NotificationRule:
    account_service.resolve_owned_account_ids(db_session=db_session, user=user, account_ids=fields["account_ids"])
    state_before_update = snapshot_columns(rule)
    apply_fields(entity=rule, fields=fields)
    db_session.commit()
    logger.update(state_before_update=state_before_update, entity_after_update=rule)
    return rule


def delete_rule(db_session: Session, rule: NotificationRule) -> None:
    db_session.delete(rule)
    db_session.commit()
    logger.info(f"Deleted notification rule {rule.id}")
