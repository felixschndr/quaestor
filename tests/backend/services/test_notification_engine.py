from datetime import date, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from source.backend.bank_handlers.base import FetchedAccount
from source.backend.helpers import utc_now
from source.backend.models.auth.user import User
from source.backend.models.banking.credential import Credential
from source.backend.models.contracts.contract import (
    OVERDUE_GRACE_DAYS,
    SHORTFALL_LOOKAHEAD_DAYS,
)
from source.backend.models.notifications.notification_rule import (
    BalanceDirection,
    DigestPeriod,
    NotificationRule,
    NotificationTrigger,
)
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.banking import credential_service
from source.backend.services.notifications import (
    notification_engine,
    notification_service,
)
from source.backend.services.notifications.notification_service import (
    Notification,
    NotificationResult,
)
from tests.backend.conftest import (
    ACCOUNT_IBAN,
    LAST_FETCHING_TIMESTAMP,
    RECENT_DATE,
    FakeBankSession,
    assert_log_contains,
    build_handler,
    create_fetched_transaction,
    make_account,
    make_contract,
    make_credential,
    make_transaction,
    make_user,
    make_user_and_credential_and_account,
)

ALL_CATEGORIES = [category.value for category in TransactionCategory]
ALL_TYPES = [transaction_type.value for transaction_type in TransactionType]


def assert_one_notification(
    notifications: list[Notification], title: str | None = None, body: str | None = None, url: str | None = None
) -> None:
    assert len(notifications) == 1
    first_notification = notifications[0]
    if title is not None:
        assert first_notification.title == title
    if body is not None:
        assert first_notification.body == body
    if url is not None:
        assert first_notification.url == url


def _make_notification_rule(
    db_session: Session,
    user_id: int,
    trigger: NotificationTrigger,
    account_ids: list[int],
    enabled: bool = True,
    include_content: bool = True,
    name: str | None = None,
    other_party_contains: str | None = None,
    categories: list[str] | None = None,
    types: list[str] | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
    threshold: float | None = None,
    direction: BalanceDirection | None = None,
    days: int | None = None,
    period: DigestPeriod | None = None,
) -> NotificationRule:
    rule = NotificationRule(
        user_id=user_id,
        trigger=trigger,
        account_ids=account_ids,
        enabled=enabled,
        include_content=include_content,
        name=name,
        other_party_contains=other_party_contains,
        categories=categories if categories is not None else [],
        types=types if types is not None else [],
        min_amount=min_amount,
        max_amount=max_amount,
        threshold=threshold,
        direction=direction,
        days=days,
        period=period,
    )
    db_session.add(rule)
    db_session.flush()
    return rule


def _account_with_notification_rule(db_session: Session, **rule_kwargs: object) -> tuple[Credential, int]:
    user, credential, account = make_user_and_credential_and_account(
        db_session, balance=rule_kwargs.pop("balance", 0.0)
    )
    _make_notification_rule(db_session, user_id=user.id, account_ids=[account.id], **rule_kwargs)
    db_session.flush()
    return credential, account.id


# --- transaction trigger ---------------------------------------------------


def test_transaction_rule_triggers_on_matching_new_transaction(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
            other_party_contains="netflix",
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        transaction = make_transaction(db_session, account_id=account_id, amount=-9.99, other_party="Netflix Intl.")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Transaction booked",
            body=f"{ACCOUNT_IBAN}: -9,99 € · Netflix Intl.",
            url=f"/account/{account_id}/transactions/{transaction.id}",
        )
    assert_log_contains(caplog, messages=["matched on", "Collected"])


def test_transaction_rule_does_not_trigger_when_sender_does_not_match(session_factory: sessionmaker):
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


def test_transaction_rule_respects_amount_bounds(session_factory: sessionmaker):
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
        in_range = make_transaction(db_session, account_id=account_id, amount=-75.0)
        make_transaction(db_session, account_id=account_id, amount=-10.0)
        make_transaction(db_session, account_id=account_id, amount=-150.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Transaction booked",
            body=f"{ACCOUNT_IBAN}: -75,00 €",
            url=f"/account/{account_id}/transactions/{in_range.id}",
        )


def test_transaction_rule_filters_by_category(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=[TransactionCategory.SUPERMARKET.value],
            types=ALL_TYPES,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        groceries = make_transaction(
            db_session, account_id=account_id, amount=-5.0, category=TransactionCategory.SUPERMARKET
        )
        make_transaction(db_session, account_id=account_id, amount=-5.0, category=TransactionCategory.RESTAURANTS)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Transaction booked",
            body=f"{ACCOUNT_IBAN}: -5,00 €",
            url=f"/account/{account_id}/transactions/{groceries.id}",
        )


def test_disabled_rule_never_triggers(session_factory: sessionmaker):
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


def test_rule_scoped_to_other_account_does_not_trigger(session_factory: sessionmaker):
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


def test_rule_with_empty_account_list_covers_every_account(session_factory: sessionmaker):
    with session_factory() as db_session:
        user = make_user(db_session)
        credential = make_credential(db_session, user_id=user.id)
        first = make_account(db_session, credential_id=credential.id, name="DE-first")
        second = make_account(db_session, credential_id=credential.id, name="DE-second")
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.TRANSACTION,
            account_ids=[],
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
        )
        db_session.flush()
        snapshot = notification_engine.capture_sync_snapshot(credential)
        for account in [first, second]:
            make_transaction(db_session, account_id=account.id, amount=-1.0, other_party="Shop")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert len(notifications) == 2


def test_first_sight_account_is_skipped(session_factory: sessionmaker):
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


def test_expected_transaction_rule_triggers_when_expectation_is_booked(session_factory: sessionmaker):
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        expected = make_transaction(
            db_session, account_id=account.id, amount=100.0, other_party="Landlord", expected=True, pending=True
        )
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.EXPECTED_TRANSACTION,
            account_ids=[account.id],
        )
        db_session.flush()
        snapshot = notification_engine.capture_sync_snapshot(credential)
        booking = make_transaction(db_session, account_id=account.id, amount=100.0, other_party="Landlord")
        booking.matched_expected_id = expected.id
        account.transactions.remove(expected)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Expected transaction booked",
            body=f"{ACCOUNT_IBAN}: 100,00 € booked · Landlord",
            url=f"/account/{account.id}/transactions/{booking.id}",
        )


def test_expected_transaction_rule_quiet_when_nothing_booked(session_factory: sessionmaker):
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
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


# --- balance-threshold trigger ---------------------------------------------


def test_balance_below_rule_triggers_on_downward_crossing(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_THRESHOLD,
            direction=BalanceDirection.BELOW,
            threshold=50.0,
            balance=100.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        account = credential.accounts[0]
        account.balance = 40.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert_one_notification(
        notifications=notifications,
        title="Balance below threshold",
        body=f"{ACCOUNT_IBAN}: 40,00 € (threshold 50,00 €)",
        url=f"/account/{account_id}",
    )
    assert notifications[0].tag is not None  # balance alerts collapse via a tag


def test_balance_below_rule_quiet_when_already_below(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_THRESHOLD,
            direction=BalanceDirection.BELOW,
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


def test_balance_above_rule_triggers_on_upward_crossing(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_THRESHOLD,
            direction=BalanceDirection.ABOVE,
            threshold=50.0,
            balance=40.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        account = credential.accounts[0]
        account.balance = 60.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert_one_notification(
        notifications=notifications,
        title="Balance above threshold",
        body=f"{ACCOUNT_IBAN}: 60,00 € (threshold 50,00 €)",
        url=f"/account/{account_id}",
    )


def test_balance_above_rule_does_not_trigger_on_downward_crossing(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_THRESHOLD,
            direction=BalanceDirection.ABOVE,
            threshold=50.0,
            balance=100.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        account = credential.accounts[0]
        account.balance = 40.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


# --- digest trigger --------------------------------------------------------

_MONDAY = date(year=2026, month=7, day=20)


def _user_with_digest_rule(db_session: Session, period: DigestPeriod, **rule_kwargs: object) -> User:
    user, credential, account = make_user_and_credential_and_account(db_session)
    _make_notification_rule(
        db_session,
        user_id=user.id,
        trigger=NotificationTrigger.DIGEST,
        account_ids=[account.id],
        period=period,
        **rule_kwargs,
    )
    return user


def test_weekly_digest_reports_the_previous_week(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user = _user_with_digest_rule(db_session, period=DigestPeriod.WEEKLY)
        account_id = user.credentials[0].accounts[0].id
        # Last week: 100 € in, 60 € out. The week before: 30 € out.
        make_transaction(db_session, account_id=account_id, amount=100.0, date=_MONDAY - timedelta(days=3))
        make_transaction(db_session, account_id=account_id, amount=-60.0, date=_MONDAY - timedelta(days=1))
        make_transaction(db_session, account_id=account_id, amount=-30.0, date=_MONDAY - timedelta(days=9))
        db_session.commit()

        notification_engine.evaluate_digests(db_session=db_session, today=_MONDAY)

    assert_one_notification(
        notifications=sent,
        title="Weekly review: 40,00 € (100 % / 30,00 € more spending than last week)",
        body="Spent 60,00 € · Received 100,00 € · 2 transactions",
        url="/stats?date_from=2026-07-13&date_to=2026-07-19",
    )
    assert_log_contains(caplog, messages=["Evaluating digest rules for", "digest for 2026-07-13..2026-07-19"])


def test_weekly_digest_is_quiet_on_other_weekdays(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        _user_with_digest_rule(db_session, period=DigestPeriod.WEEKLY)
        db_session.commit()

        notification_engine.evaluate_digests(db_session=db_session, today=_MONDAY + timedelta(days=1))

    assert sent == []


def test_monthly_digest_reports_the_previous_month(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user = _user_with_digest_rule(db_session, period=DigestPeriod.MONTHLY)
        account_id = user.credentials[0].accounts[0].id
        make_transaction(db_session, account_id=account_id, amount=-20.0, date=date(year=2026, month=6, day=15))
        db_session.commit()

        notification_engine.evaluate_digests(db_session=db_session, today=date(year=2026, month=7, day=1))

    assert_one_notification(
        notifications=sent,
        title="Monthly review: -20,00 €",
        body="Spent 20,00 € · Received 0,00 € · 1 transactions",
        url="/stats?date_from=2026-06-01&date_to=2026-06-30",
    )


def test_digest_without_content_hides_the_amounts(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user = _user_with_digest_rule(db_session, period=DigestPeriod.WEEKLY, include_content=False)
        make_transaction(
            db_session,
            account_id=user.credentials[0].accounts[0].id,
            amount=-60.0,
            date=_MONDAY - timedelta(days=1),
        )
        db_session.commit()

        notification_engine.evaluate_digests(db_session=db_session, today=_MONDAY)

    assert_one_notification(
        notifications=sent,
        title="Weekly review",
        body="See it in the statistics",
        url="/stats?date_from=2026-07-13&date_to=2026-07-19",
    )


# --- duplicate transaction trigger -----------------------------------------


def test_duplicate_booking_notifies(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session, trigger=NotificationTrigger.DUPLICATE_TRANSACTION
        )
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="Netflix")
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="netflix")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Possible duplicate booking",
            body=f"{ACCOUNT_IBAN}: -42,00 € · netflix booked twice within 3 days",
            url=(
                f"/account/{account_id}/search?account_ids={account_id}&amount_from=-42.01"
                f"&amount_to=-41.99&date_from={RECENT_DATE.isoformat()}"
                f"&date_to={RECENT_DATE.isoformat()}&text=netflix"
            ),
        )
        assert_log_contains(caplog, message="looks like a duplicate of")


def test_duplicate_outside_the_window_is_quiet(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session, trigger=NotificationTrigger.DUPLICATE_TRANSACTION, days=3
        )
        make_transaction(
            db_session, account_id=account_id, amount=-42.0, other_party="Netflix", date=RECENT_DATE - timedelta(days=4)
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="Netflix")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_different_other_party_or_amount_is_no_duplicate(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session, trigger=NotificationTrigger.DUPLICATE_TRANSACTION
        )
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="Netflix")
        make_transaction(db_session, account_id=account_id, amount=-11.0, other_party="Spotify")
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="Spotify")
        make_transaction(db_session, account_id=account_id, amount=-11.0, other_party="Netflix")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_duplicate_without_other_party_is_quiet(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session, trigger=NotificationTrigger.DUPLICATE_TRANSACTION
        )
        make_transaction(db_session, account_id=account_id, amount=-42.0)
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-42.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_two_new_duplicates_notify_once(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session, trigger=NotificationTrigger.DUPLICATE_TRANSACTION
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="Netflix")
        make_transaction(db_session, account_id=account_id, amount=-42.0, other_party="Netflix")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Possible duplicate booking",
            body=f"{ACCOUNT_IBAN}: -42,00 € · Netflix booked twice within 3 days",
            url=(
                f"/account/{account_id}/search?account_ids={account_id}&amount_from=-42.01"
                f"&amount_to=-41.99&date_from={RECENT_DATE.isoformat()}"
                f"&date_to={RECENT_DATE.isoformat()}&text=Netflix"
            ),
        )


# --- contract amount increased trigger -------------------------------------


def _contract_charge(
    db_session: Session, amount: float, median: float = -50.0, spread: float = 1.0
) -> tuple[Credential, notification_engine.SyncSnapshot]:
    credential, account_id = _account_with_notification_rule(
        db_session, trigger=NotificationTrigger.CONTRACT_AMOUNT_INCREASED
    )
    contract = make_contract(db_session, account_id=account_id, name="Gym", median_amount=median, amount_spread=spread)
    snapshot = notification_engine.capture_sync_snapshot(credential)
    transaction = make_transaction(db_session, account_id=account_id, amount=amount)
    transaction.contract_id = contract.id
    db_session.flush()
    return credential, snapshot


def test_contract_amount_increase_notifies(session_factory: sessionmaker, caplog: pytest.LogCaptureFixture):
    with session_factory() as db_session:
        credential, snapshot = _contract_charge(db_session, amount=-70.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Contract amount increased",
            body=f"{ACCOUNT_IBAN}: Gym -70,00 € instead of -50,00 €",
            url=f"/contracts/{credential.accounts[0].contracts[0].id}",
        )
        assert_log_contains(caplog, message="against a median of")


def test_contract_amount_within_usual_spread_is_quiet(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, snapshot = _contract_charge(db_session, amount=-51.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_contract_amount_drop_is_quiet(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, snapshot = _contract_charge(db_session, amount=-10.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_incoming_contract_reports_a_bigger_payout(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, snapshot = _contract_charge(db_session, amount=3000.0, median=2000.0, spread=10.0)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Contract amount increased",
            body=f"{ACCOUNT_IBAN}: Gym 3.000,00 € instead of 2.000,00 €",
            url=f"/contracts/{credential.accounts[0].contracts[0].id}",
        )


# --- upcoming shortfall trigger --------------------------------------------


def _account_with_shortfall_rule(
    db_session: Session, balance: float, due_in_days: int, median_amount: float, days: int | None = None
) -> Credential:
    credential, account_id = _account_with_notification_rule(
        db_session,
        trigger=NotificationTrigger.UPCOMING_SHORTFALL,
        balance=balance,
        days=days,
    )
    make_contract(
        db_session,
        account_id=account_id,
        expected_next_date=date.today() + timedelta(days=due_in_days),
        median_amount=median_amount,
    )
    db_session.flush()
    return credential


def test_upcoming_shortfall_notifies_when_balance_drops_below_due_payments(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential = _account_with_shortfall_rule(db_session, balance=500.0, due_in_days=3, median_amount=-300.0)
        snapshot = notification_engine.capture_sync_snapshot(credential)
        credential.accounts[0].balance = 100.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert_one_notification(
        notifications=notifications,
        title="Upcoming payments exceed balance",
        body=f"{ACCOUNT_IBAN}: 300,00 € due within 7 days, only 100,00 € available",
        url=f"/account/{credential.accounts[0].id}",
    )


def test_upcoming_shortfall_quiet_when_balance_still_covers_payments(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential = _account_with_shortfall_rule(db_session, balance=500.0, due_in_days=3, median_amount=-300.0)
        snapshot = notification_engine.capture_sync_snapshot(credential)
        credential.accounts[0].balance = 400.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_upcoming_shortfall_ignores_payments_beyond_the_lookahead(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential = _account_with_shortfall_rule(
            db_session,
            balance=500.0,
            due_in_days=SHORTFALL_LOOKAHEAD_DAYS + 1,
            median_amount=-300.0,
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        credential.accounts[0].balance = 100.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


def test_upcoming_shortfall_honours_a_custom_lookahead(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential = _account_with_shortfall_rule(
            db_session, balance=500.0, due_in_days=20, median_amount=-300.0, days=30
        )
        snapshot = notification_engine.capture_sync_snapshot(credential)
        credential.accounts[0].balance = 100.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert_one_notification(
        notifications=notifications,
        title="Upcoming payments exceed balance",
        body=f"{ACCOUNT_IBAN}: 300,00 € due within 30 days, only 100,00 € available",
        url=f"/account/{credential.accounts[0].id}",
    )


def test_upcoming_shortfall_quiet_when_already_short_before_sync(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential = _account_with_shortfall_rule(db_session, balance=100.0, due_in_days=3, median_amount=-300.0)
        snapshot = notification_engine.capture_sync_snapshot(credential)
        credential.accounts[0].balance = 50.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert notifications == []


# --- include_content (content redaction) -----------------------------------


def test_transaction_rule_without_content_omits_amount_and_other_party(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.TRANSACTION,
            categories=ALL_CATEGORIES,
            types=ALL_TYPES,
            include_content=False,
        )
        account_label = credential.accounts[0].display_label
        snapshot = notification_engine.capture_sync_snapshot(credential)
        transaction = make_transaction(db_session, account_id=account_id, amount=-42.50, other_party="Netflix Intl.")

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Transaction booked",
            body=account_label,
            url=f"/account/{account_id}/transactions/{transaction.id}",
        )


def test_balance_below_rule_without_content_omits_balance_and_threshold(session_factory: sessionmaker):
    with session_factory() as db_session:
        credential, account_id = _account_with_notification_rule(
            db_session,
            trigger=NotificationTrigger.BALANCE_THRESHOLD,
            direction=BalanceDirection.BELOW,
            threshold=50.0,
            balance=100.0,
            include_content=False,
        )
        account_label = credential.accounts[0].display_label
        snapshot = notification_engine.capture_sync_snapshot(credential)
        credential.accounts[0].balance = 40.0

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert_one_notification(
        notifications=notifications,
        title="Balance below threshold",
        body=account_label,
        url=f"/account/{account_id}",
    )


def test_expected_transaction_rule_without_content_omits_amount(session_factory: sessionmaker):
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        expected = make_transaction(db_session, account_id=account.id, amount=123.45, expected=True, pending=True)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.EXPECTED_TRANSACTION,
            account_ids=[account.id],
            include_content=False,
        )
        db_session.flush()
        account_label = account.display_label
        snapshot = notification_engine.capture_sync_snapshot(credential)
        booking = make_transaction(db_session, account_id=account.id, amount=123.45)
        booking.matched_expected_id = expected.id
        account.transactions.remove(expected)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

        assert_one_notification(
            notifications=notifications,
            title="Expected transaction booked",
            body=account_label,
            url=f"/account/{account.id}/transactions/{booking.id}",
        )


# --- dispatch + full sync wiring -------------------------------------------


def test_dispatch_sends_each_notification_to_the_user(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
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
    assert_log_contains(caplog, message="Dispatching")


def test_sync_credential_triggers_notification_end_to_end(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    sent_notifications = []
    monkeypatch.setattr(
        target=notification_service,
        name="notify_user",
        value=lambda *, db_session, user, notification: sent_notifications.append(notification) or NotificationResult(),
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

    assert len(sent_notifications) == 1
    assert sent_notifications[0].body == f"{ACCOUNT_IBAN}: -20,00 € · Corner Shop"


# --- contract overdue trigger ----------------------------------------------

_TODAY = RECENT_DATE


def _capture_sent(monkeypatch: pytest.MonkeyPatch) -> list[Notification]:
    sent_notifications = []
    monkeypatch.setattr(
        target=notification_service,
        name="notify_user",
        value=lambda db_session, user, notification: sent_notifications.append(notification) or NotificationResult(),
    )
    return sent_notifications


def test_overdue_contract_notifies_once_and_dedups(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.CONTRACT_OVERDUE,
            account_ids=[account.id],
        )
        contract = make_contract(
            db_session,
            account_id=account.id,
            expected_next_date=_TODAY - timedelta(days=OVERDUE_GRACE_DAYS + 1),
        )
        db_session.commit()

        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=_TODAY)
        assert_one_notification(
            notifications=sent,
            title="Payment overdue",
            body=f"{ACCOUNT_IBAN}: Gym overdue since {contract.expected_next_date.isoformat()}",
            url=f"/contracts/{contract.id}",
        )
        assert contract.overdue_notified_at is not None
        assert_log_contains(
            caplog, messages=["Evaluating overdue contracts for", "is overdue (expected", "queued notification"]
        )

        # A second run on the same overdue episode must not notify again.
        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=_TODAY)
        assert len(sent) == 1


def test_overdue_contract_honours_a_custom_grace_period(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.CONTRACT_OVERDUE,
            account_ids=[account.id],
            days=1,
        )
        make_contract(db_session, account_id=account.id, expected_next_date=_TODAY - timedelta(days=2))
        db_session.commit()

        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=_TODAY)

    # Two days late is within the default grace of five, but past the rule's own single day.
    assert len(sent) == 1


def test_contract_within_grace_period_does_not_notify(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.CONTRACT_OVERDUE,
            account_ids=[account.id],
        )
        make_contract(db_session, account_id=account.id, expected_next_date=_TODAY)
        db_session.commit()

        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=_TODAY)

    assert sent == []


def test_overdue_contract_without_covering_rule_is_not_notified(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    sent = _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        contract = make_contract(
            db_session,
            account_id=account.id,
            expected_next_date=_TODAY - timedelta(days=OVERDUE_GRACE_DAYS + 1),
        )
        db_session.commit()

        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=_TODAY)

        assert sent == []
        assert contract.overdue_notified_at is None


def test_overdue_flag_resets_once_payment_arrives(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    _capture_sent(monkeypatch)
    with session_factory() as db_session:
        user, credential, account = make_user_and_credential_and_account(db_session)
        _make_notification_rule(
            db_session,
            user_id=user.id,
            trigger=NotificationTrigger.CONTRACT_OVERDUE,
            account_ids=[account.id],
        )
        contract = make_contract(db_session, account_id=account.id, expected_next_date=_TODAY + timedelta(days=20))
        contract.overdue_notified_at = utc_now()
        db_session.commit()

        notification_engine.evaluate_overdue_contracts(db_session=db_session, today=_TODAY)

        assert contract.overdue_notified_at is None


def test_notifications_are_rendered_in_recipient_language(session_factory: sessionmaker):
    with session_factory() as db_session:
        user = make_user(db_session, language="de")
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
        account.transactions.remove(expected)

        notifications = notification_engine.collect_notifications(
            db_session=db_session, credential=credential, snapshot=snapshot
        )

    assert_one_notification(
        notifications=notifications,
        title="Erwartete Transaktion gebucht",
        body=f"{ACCOUNT_IBAN}: 100,00 € gebucht",
        url=f"/account/{account.id}",
    )
