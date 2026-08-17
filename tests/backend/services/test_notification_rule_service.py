import importlib
from types import ModuleType

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
_END_MIGRATION = importlib.import_module("source.backend.alembic.versions.0052_default_contract_end_notification_rules")
_DETECTED_MIGRATION = importlib.import_module(
    "source.backend.alembic.versions.0060_default_contract_detected_notification_rules"
)

_DEFAULT_TRIGGERS = {
    NotificationTrigger.EXPECTED_TRANSACTION,
    NotificationTrigger.UPCOMING_SHORTFALL,
    NotificationTrigger.DUPLICATE_TRANSACTION,
    NotificationTrigger.CONTRACT_OVERDUE,
    NotificationTrigger.CONTRACT_ENDING,
    NotificationTrigger.CONTRACT_CHARGED_AFTER_END,
    NotificationTrigger.CONTRACT_DETECTED,
    NotificationTrigger.CONTRACT_AMOUNT_INCREASED,
    NotificationTrigger.DIGEST,
}

_MIGRATION_0044_TRIGGERS = {
    NotificationTrigger.EXPECTED_TRANSACTION,
    NotificationTrigger.UPCOMING_SHORTFALL,
    NotificationTrigger.DUPLICATE_TRANSACTION,
    NotificationTrigger.CONTRACT_OVERDUE,
    NotificationTrigger.CONTRACT_AMOUNT_INCREASED,
    NotificationTrigger.DIGEST,
}

_MIGRATION_0052_TRIGGERS = {
    NotificationTrigger.CONTRACT_ENDING,
    NotificationTrigger.CONTRACT_CHARGED_AFTER_END,
}


def _capture_statements(migration: ModuleType, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    statements: list[str] = []
    monkeypatch.setattr(
        target=migration, name="op", value=type("Op", (), {"execute": lambda _, sql: statements.append(sql)})()
    )
    migration.upgrade()
    return statements


def test_new_user_gets_default_rules(session_factory: sessionmaker):
    with session_factory() as db_session:
        user = user_service.create_user(
            db_session=db_session, user_name=USER_NAME, display_name=DISPLAY_NAME, password=VALID_PASSWORD
        )

        rules = notification_rule_service.list_rules(db_session=db_session, user=user)

        assert {rule.trigger for rule in rules} == _DEFAULT_TRIGGERS
        assert all(rule.enabled and rule.account_ids == [] for rule in rules)
        digest = next(rule for rule in rules if rule.trigger is NotificationTrigger.DIGEST)
        assert digest.period is DigestPeriod.WEEKLY
        assert digest.weekday == DEFAULT_DIGEST_WEEKDAY


def test_migration_backfills_only_users_without_rules(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    statements = _capture_statements(migration=_MIGRATION, monkeypatch=monkeypatch)

    with session_factory() as db_session:
        first_user = make_user(db_session, user_name=USER_NAME)
        second_user = make_user(db_session, user_name=SECOND_USER_NAME)
        notification_rule_service.create_default_rules(db_session=db_session, user=first_user)

        for statement in statements:
            db_session.execute(text(statement))
        db_session.commit()

        assert {
            rule.trigger for rule in notification_rule_service.list_rules(db_session=db_session, user=second_user)
        } == _MIGRATION_0044_TRIGGERS
        assert len(notification_rule_service.list_rules(db_session=db_session, user=first_user)) == len(
            _DEFAULT_TRIGGERS
        )


def test_contract_end_migration_backfills_missing_triggers(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    statements = _capture_statements(migration=_END_MIGRATION, monkeypatch=monkeypatch)

    with session_factory() as db_session:
        with_defaults = make_user(db_session, user_name=USER_NAME)
        without = make_user(db_session, user_name=SECOND_USER_NAME)
        notification_rule_service.create_default_rules(db_session=db_session, user=with_defaults)

        for statement in statements:
            db_session.execute(text(statement))
        db_session.commit()

        # A user who lacked the contract-end triggers gains exactly those two.
        assert {
            rule.trigger for rule in notification_rule_service.list_rules(db_session=db_session, user=without)
        } == _MIGRATION_0052_TRIGGERS
        # A user who already had them (via the default set) gets no duplicates.
        assert len(notification_rule_service.list_rules(db_session=db_session, user=with_defaults)) == len(
            _DEFAULT_TRIGGERS
        )


def test_contract_detected_migration_backfills_all_users(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    statements = _capture_statements(migration=_DETECTED_MIGRATION, monkeypatch=monkeypatch)

    with session_factory() as db_session:
        first = make_user(db_session, user_name=USER_NAME)
        second = make_user(db_session, user_name=SECOND_USER_NAME)

        for statement in statements:
            db_session.execute(text(statement))
        db_session.commit()

        for user in (first, second):
            triggers = [rule.trigger for rule in notification_rule_service.list_rules(db_session=db_session, user=user)]
            assert triggers == [NotificationTrigger.CONTRACT_DETECTED]
