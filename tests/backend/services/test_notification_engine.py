import pytest
from source.backend.bank_handlers.base import FetchedAccount
from source.backend.models.credential import Credential
from source.backend.models.notification_rule import (
    NotificationRule,
    NotificationTrigger,
)
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from source.backend.services import (
    credential_service,
    notification_engine,
    notification_service,
)
from source.backend.services.notification_service import (
    Notification,
    NotificationResult,
)
from sqlalchemy.orm import Session, sessionmaker

from tests.backend.conftest import (
    ACCOUNT_IBAN,
    LAST_FETCHING_TIMESTAMP,
    FakeBankSession,
    build_handler,
    create_fetched_transaction,
    make_account,
    make_credential,
    make_transaction,
    make_user,
)

ALL_CATEGORIES = [category.value for category in TransactionCategory]
ALL_TYPES = [transaction_type.value for transaction_type in TransactionType]


def _make_notification_rule(
    db_session: Session,
    *,
    user_id: int,
    trigger: NotificationTrigger,
    account_ids: list[int],
    enabled: bool = True,
    name: str | None = None,
    other_party_contains: str | None = None,
    categories: list[str] | None = None,
    types: list[str] | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
    threshold: float | None = None,
) -> NotificationRule:
    rule = NotificationRule(
        user_id=user_id,
        trigger=trigger,
        account_ids=account_ids,
        enabled=enabled,
        name=name,
        other_party_contains=other_party_contains,
        categories=categories if categories is not None else [],
        types=types if types is not None else [],
        min_amount=min_amount,
        max_amount=max_amount,
        threshold=threshold,
    )
    db_session.add(rule)
    db_session.flush()
    return rule


def _account_with_notification_rule(db_session: Session, **rule_kwargs: object) -> tuple[Credential, int]:
    user = make_user(db_session)
    credential = make_credential(db_session, user_id=user.id)
    account = make_account(db_session, credential_id=credential.id, balance=rule_kwargs.pop("balance", 0.0))
    _make_notification_rule(db_session, user_id=user.id, account_ids=[account.id], **rule_kwargs)
    db_session.flush()
    return credential, account.id


# --- transaction trigger ---------------------------------------------------


def test_transaction_rule_triggers_on_matching_new_transaction(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
            other_party_contains="netflix",
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-9.99, other_party="Netflix Intl.")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert len(notifications) == 1
    assert "Netflix" in notifications[0].body


def test_transaction_rule_does_not_trigger_when_sender_does_not_match(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
            other_party_contains="netflix",
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-9.99, other_party="Spotify")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_transaction_rule_respects_amount_bounds(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
            min_amount=-100.0,
            max_amount=-50.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-75.0)  # in range
        make_transaction(db_session, account_id=account_id, amount=-10.0)
        make_transaction(db_session, account_id=account_id, amount=-150.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert len(notifications) == 1
    assert "75.00" in notifications[0].body


def test_transaction_rule_filters_by_category(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=[TransactionCategory.SUPERMARKET.value],
            types=ALL_TYPES,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-5.0, category=TransactionCategory.SUPERMARKET)
        make_transaction(db_session, account_id=account_id, amount=-5.0, category=TransactionCategory.RESTAURANTS)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert len(notifications) == 1


def test_disabled_rule_never_triggers(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
            enabled=False,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-9.99, other_party="Anything")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_rule_scoped_to_other_account_does_not_trigger(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        user = make_user(db_session)
        credential = make_credential(db_session, user_id=user.id)
        watched = make_account(db_session, credential_id=credential.id, name="DE-watched")
        other = make_account(db_session, credential_id=credential.id, name="DE-other")
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.TRANSACTION,
            account_ids=[watched.id],
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
        )
        db_session.flush()
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=other.id, amount=-9.99, other_party="Shop")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_first_sight_account_is_skipped(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        user = make_user(db_session)
        credential = make_credential(db_session, user_id=user.id)
        snapshot = notification_engine.capture_sync_snapshot(credential)  # no accounts yet
        account = make_account(db_session, credential_id=credential.id)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.TRANSACTION,
            account_ids=[account.id],
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
        )
        make_transaction(db_session, account_id=account.id, amount=-9.99, other_party="History")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


# --- expected-transaction trigger ------------------------------------------


def test_expected_transaction_rule_triggers_when_expectation_is_booked(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        user = make_user(db_session)
        credential = make_credential(db_session, user_id=user.id)
        account = make_account(db_session, credential_id=credential.id)
        expected = make_transaction(db_session, account_id=account.id, amount=100.0, expected=True, pending=True)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.EXPECTED_TRANSACTION,
            account_ids=[account.id],
        )
        db_session.flush()
        snapshot = notification_engine.capture_sync_snapshot(credential)
        # The sync matches & removes the expectation; simulate that removal.
        account.transactions.remove(expected)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert len(notifications) == 1
    assert "booked" in notifications[0].body.lower()


def test_expected_transaction_rule_quiet_when_nothing_booked(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        user = make_user(db_session)
        credential = make_credential(db_session, user_id=user.id)
        account = make_account(db_session, credential_id=credential.id)
        make_transaction(db_session, account_id=account.id, amount=100.0, expected=True, pending=True)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.EXPECTED_TRANSACTION,
            account_ids=[account.id],
        )
        db_session.flush()
        snapshot = notification_engine.capture_sync_snapshot(credential)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


# --- balance-below trigger -------------------------------------------------


def test_balance_below_rule_triggers_on_crossing(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_BELOW,
            threshold=50.0,
            balance=100.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        account = credential.accounts[0]
        account.balance = 40.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert len(notifications) == 1
    assert notifications[0].tag is not None  # balance alerts collapse via a tag


def test_balance_below_rule_quiet_when_already_below(session_factory: sessionmaker) -> None:
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_BELOW,
            threshold=50.0,
            balance=40.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        account = credential.accounts[0]
        account.balance = 30.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


# --- dispatch + full sync wiring -------------------------------------------


def test_dispatch_sends_each_notification_to_the_user(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[Notification] = []
    monkeypatch.setattr(
        target=notification_service,
        name="notify_user",
        value=lambda db_session, user, notification: sent.append(notification) or NotificationResult(),
    )

    with session_factory() as db_session:
        user = make_user(db_session)
        db_session.flush()
        notification_engine.dispatch(
            db_session=db_session,
            user=user,
            notifications=[Notification(title="a", body="b"), Notification(title="c", body="d")],
        )

    assert [notification.title for notification in sent] == ["a", "c"]


def test_sync_credential_triggers_notification_end_to_end(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[Notification] = []
    monkeypatch.setattr(
        target=notification_service,
        name="notify_user",
        value=lambda *, db_session, user, notification: sent.append(notification) or NotificationResult(),
    )

    handler = build_handler(
        FakeBankSession(
            accounts=[FetchedAccount(name=ACCOUNT_IBAN)],
            balances={ACCOUNT_IBAN: 0.0},
            transactions={ACCOUNT_IBAN: [create_fetched_transaction(amount=-20.0, other_party="Corner Shop")]},
        )
    )
    monkeypatch.setattr(target=Credential, name="handler", value=property(lambda self: handler))

    with session_factory() as db_session:
        user = make_user(db_session)
        credential = make_credential(db_session, user_id=user.id, last_fetching_timestamp=LAST_FETCHING_TIMESTAMP)
        account = make_account(db_session, credential_id=credential.id, name=ACCOUNT_IBAN)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.TRANSACTION,
            account_ids=[account.id],
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
        )
        db_session.commit()

        credential_service.sync_credential(db_session=db_session, credential_id=credential.id)

    assert len(sent) == 1
    assert "Corner Shop" in sent[0].body
