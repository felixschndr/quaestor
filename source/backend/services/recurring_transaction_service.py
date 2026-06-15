import calendar
from datetime import date, timedelta

from source.backend.exceptions import RecurringTransactionNotFoundError
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.base import snapshot_columns
from source.backend.models.recurrence_frequency import RecurrenceFrequency
from source.backend.models.recurring_transaction import RecurringTransaction
from source.backend.models.transaction import Transaction
from source.backend.services import account_service
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


def _clamped_day_of_month(year: int, month: int, day: int) -> int:
    last_day = calendar.monthrange(year=year, month=month)[1]
    return min(day, last_day)


def next_monthly(from_date: date, day: int, after: bool = False) -> date:
    year, month = from_date.year, from_date.month
    while True:
        candidate = date(year=year, month=month, day=_clamped_day_of_month(year=year, month=month, day=day))
        if candidate > from_date or (candidate == from_date and not after):
            return candidate
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def next_weekly(from_date: date, weekday: int, after: bool = False) -> date:
    delta = (weekday - from_date.weekday()) % 7
    if after and delta == 0:
        delta = 7
    return from_date + timedelta(days=delta)


def _next_occurrence(rule: RecurringTransaction, from_date: date, *, after: bool) -> date:
    if rule.frequency == RecurrenceFrequency.MONTHLY:
        return next_monthly(from_date=from_date, day=rule.day_of_month, after=after)
    return next_weekly(from_date=from_date, weekday=rule.day_of_week, after=after)


def _book_occurrence(db_session: Session, account: Account, rule: RecurringTransaction, on_date: date) -> Transaction:
    fields: dict = {
        "amount": rule.amount,
        "date": on_date,
        "purpose": rule.purpose,
        "other_party": rule.other_party,
        "transaction_type": rule.transaction_type,
        "note": rule.note,
    }
    if rule.category is not None:
        fields["category"] = rule.category
    return account_service.create_manual_transaction(
        db_session=db_session, account=account, fields=fields, recurring_transaction_id=rule.id
    )


def get_recurring_transaction_for_account(
    db_session: Session, account: Account, recurring_transaction_id: int
) -> RecurringTransaction:
    rule = db_session.get(entity=RecurringTransaction, ident=recurring_transaction_id)
    if rule is None or rule.account_id != account.id:
        logger.warning(f"Recurring transaction {recurring_transaction_id} not found for {account}")
        raise RecurringTransactionNotFoundError(
            f"Recurring transaction with the ID {recurring_transaction_id} not found"
        )
    return rule


def list_recurring_transactions(db_session: Session, account: Account) -> list[RecurringTransaction]:
    rules = list(
        db_session.scalars(
            select(RecurringTransaction)
            .where(RecurringTransaction.account_id == account.id)
            .order_by(RecurringTransaction.created_at.desc())
        )
    )
    logger.debug(f"Found {len(rules)} recurring transaction(s) for {account}")
    return rules


def create_recurring_transaction(
    db_session: Session, account: Account, fields: dict, book_immediately: bool
) -> RecurringTransaction:
    account_service._require_manual_account(account)
    today = date.today()
    rule = RecurringTransaction(
        account=account,
        amount=fields["amount"],
        purpose=fields.get("purpose"),
        other_party=fields.get("other_party"),
        transaction_type=fields.get("transaction_type"),
        category=fields.get("category"),
        note=fields.get("note"),
        frequency=fields["frequency"],
        day_of_month=fields.get("day_of_month"),
        day_of_week=fields.get("day_of_week"),
        created_at=utc_now(),
        next_run_date=today,  # Provisional; finalised below once we know whether we book today.
    )
    db_session.add(rule)
    db_session.flush()  # assign rule.id so booked transactions can link back

    if book_immediately:
        _book_occurrence(db_session=db_session, account=account, rule=rule, on_date=today)
        rule.next_run_date = _next_occurrence(rule, from_date=today, after=True)
    else:
        rule.next_run_date = _next_occurrence(rule, from_date=today, after=False)

    db_session.commit()
    logger.info(f"Created {rule} on {account}; next run {rule.next_run_date} (booked today: {book_immediately})")
    return rule


def update_recurring_transaction(
    db_session: Session, account: Account, recurring_transaction_id: int, fields: dict
) -> RecurringTransaction:
    rule = get_recurring_transaction_for_account(
        db_session=db_session, account=account, recurring_transaction_id=recurring_transaction_id
    )
    schedule_changed = (
        fields["frequency"] != rule.frequency
        or fields.get("day_of_month") != rule.day_of_month
        or fields.get("day_of_week") != rule.day_of_week
    )
    state_before_update = snapshot_columns(rule)
    rule.amount = fields["amount"]
    rule.purpose = fields.get("purpose")
    rule.other_party = fields.get("other_party")
    rule.transaction_type = fields.get("transaction_type")
    rule.category = fields.get("category")
    rule.note = fields.get("note")
    rule.frequency = fields["frequency"]
    rule.day_of_month = fields.get("day_of_month")
    rule.day_of_week = fields.get("day_of_week")
    if schedule_changed:
        # Re-anchor the cursor only when the schedule itself moved, so editing just the
        # amount/note leaves the next booking date untouched.
        rule.next_run_date = _next_occurrence(rule, from_date=date.today(), after=False)
    db_session.commit()
    logger.update(state_before_update=state_before_update, entity_after_update=rule)
    return rule


def delete_recurring_transaction(db_session: Session, account: Account, recurring_transaction_id: int) -> None:
    rule = get_recurring_transaction_for_account(
        db_session=db_session, account=account, recurring_transaction_id=recurring_transaction_id
    )
    # The before_delete event detaches any transactions this rule already booked so they stay
    db_session.delete(rule)
    db_session.commit()
    logger.info(f"Deleted recurring transaction {recurring_transaction_id} from {account}")


def book_due_recurring_transactions(db_session: Session) -> int:
    today = date.today()
    due_rules = list(
        db_session.scalars(select(RecurringTransaction).where(RecurringTransaction.next_run_date <= today))
    )
    booked = 0
    for rule in due_rules:
        account = rule.account
        catch_up = 0
        while rule.next_run_date <= today:
            _book_occurrence(db_session=db_session, account=account, rule=rule, on_date=rule.next_run_date)
            rule.next_run_date = _next_occurrence(rule, from_date=rule.next_run_date, after=True)
            booked += 1
            catch_up += 1
        db_session.commit()
    if booked:
        logger.info(f"Booked {booked} due recurring transaction(s) across {len(due_rules)} rule(s)")
    return booked
