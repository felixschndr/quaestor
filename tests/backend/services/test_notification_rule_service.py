import importlib

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from source.backend.models.notifications.notification_rule import (
    DEFAULT_DIGEST_WEEKDAY,
    DigestPeriod,
    NotificationTrigger,
)
from source.backend.services.auth import user_service
from source.backend.services.notifications import notification_rule_service
from tests.backend.conftest import (
    DISPLAY_NAME,
    SECOND_USER_NAME,
    USER_NAME,
    VALID_PASSWORD,
    make_user,
)

_MIGRATION = importlib.import_module("source.backend.alembic.versions.0044_default_notification_rules")

_EXPECTED_TRIGGERS = {
    NotificationTrigger.EXPECTED_TRANSACTION,
    NotificationTrigger.UPCOMING_SHORTFALL,
    NotificationTrigger.DUPLICATE_TRANSACTION,
    NotificationTrigger.CONTRACT_OVERDUE,
    NotificationTrigger.CONTRACT_AMOUNT_INCREASED,
    NotificationTrigger.DIGEST,
}


def test_new_user_gets_default_rules(session_factory: sessionmaker):
    with session_factory() as db_session:
        user = user_service.create_user(
            db_session=db_session, user_name=USER_NAME, display_name=DISPLAY_NAME, password=VALID_PASSWORD
        )

        rules = notification_rule_service.list_rules(db_session=db_session, user=user)

        assert {rule.trigger for rule in rules} == _EXPECTED_TRIGGERS
        assert all(rule.enabled and rule.account_ids == [] for rule in rules)
        digest = next(rule for rule in rules if rule.trigger is NotificationTrigger.DIGEST)
        assert digest.period is DigestPeriod.WEEKLY
        assert digest.weekday == DEFAULT_DIGEST_WEEKDAY


def test_migration_backfills_only_users_without_rules(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    statements: list[str] = []
    monkeypatch.setattr(
        target=_MIGRATION, name="op", value=type("Op", (), {"execute": lambda _, sql: statements.append(sql)})()
    )
    _MIGRATION.upgrade()

    with session_factory() as db_session:
        first_user = make_user(db_session, user_name=USER_NAME)
        second_user = make_user(db_session, user_name=SECOND_USER_NAME)
        notification_rule_service.create_default_rules(db_session=db_session, user=first_user)

        for statement in statements:
            db_session.execute(text(statement))
        db_session.commit()

        assert {
            rule.trigger for rule in notification_rule_service.list_rules(db_session=db_session, user=second_user)
        } == _EXPECTED_TRIGGERS
        assert len(notification_rule_service.list_rules(db_session=db_session, user=first_user)) == len(
            _EXPECTED_TRIGGERS
        )
