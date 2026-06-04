import datetime

from source.backend.api.schemas.statistics import (
    CategorySlice,
    MonthlyCashflow,
    MonthlyNetSavings,
    OtherPartySlice,
    StatisticsDirection,
)
from source.backend.logging_utils import get_logger
from source.backend.models.transaction import Transaction
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.user import User
from source.backend.services import account_service
from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

DEFAULT_TOP_OTHER_PARTIES_LIMIT = 15


def _base_conditions(
    *,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
) -> list[ColumnElement[bool]]:
    # Conditions shared by every statistic
    conditions: list[ColumnElement[bool]] = [
        Transaction.account_id.in_(account_ids),
        Transaction.pending.is_(False),
    ]
    if date_from is not None:
        conditions.append(Transaction.date >= date_from)
    if date_to is not None:
        conditions.append(Transaction.date <= date_to)
    if categories:
        conditions.append(Transaction.category.in_(categories))
    return conditions


def _direction_condition(direction: StatisticsDirection) -> ColumnElement[bool]:
    if direction == "OUTGOING":
        return Transaction.amount < 0
    return Transaction.amount > 0


def category_breakdown(
    *,
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    direction: StatisticsDirection,
    categories: list[TransactionCategory],
) -> list[CategorySlice]:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    if not owned_account_ids:
        return []

    total = func.sum(Transaction.amount)
    rows = db_session.execute(
        select(Transaction.category, total)  # noqa: FKA100
        .where(
            *_base_conditions(
                account_ids=owned_account_ids, date_from=date_from, date_to=date_to, categories=categories
            )
        )
        .where(_direction_condition(direction))
        .group_by(Transaction.category)
    ).all()

    slices = [CategorySlice(category=category, total=round(number=abs(amount), ndigits=2)) for category, amount in rows]
    slices.sort(key=lambda category_slice: category_slice.total, reverse=True)
    logger.debug(f"Computed {direction} category breakdown ({len(slices)} categories) for {user}")
    return slices


def _monthly_cashflow(
    *,
    db_session: Session,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
) -> list[MonthlyCashflow]:
    month = func.strftime("%Y-%m", Transaction.date)  # noqa: FKA100
    income = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0.0))
    expenses = func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0.0))
    rows = db_session.execute(
        select(month, income, expenses)  # noqa: FKA100
        .where(*_base_conditions(account_ids=account_ids, date_from=date_from, date_to=date_to, categories=categories))
        .group_by(month)
        .order_by(month)
    ).all()
    return [
        MonthlyCashflow(
            month=month_value,
            income=round(number=income_value, ndigits=2),
            expenses=round(number=expenses_value, ndigits=2),
        )
        for month_value, income_value, expenses_value in rows
    ]


def monthly_cashflow(
    *,
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
) -> list[MonthlyCashflow]:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    if not owned_account_ids:
        return []
    cashflow = _monthly_cashflow(
        db_session=db_session,
        account_ids=owned_account_ids,
        date_from=date_from,
        date_to=date_to,
        categories=categories,
    )
    logger.debug(f"Computed monthly cashflow over {len(cashflow)} month(s) for {user}")
    return cashflow


def monthly_net_savings(
    *,
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
) -> list[MonthlyNetSavings]:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    if not owned_account_ids:
        return []
    cashflow = _monthly_cashflow(
        db_session=db_session,
        account_ids=owned_account_ids,
        date_from=date_from,
        date_to=date_to,
        categories=categories,
    )
    result = []
    for entry in cashflow:
        net = round(number=entry.income - entry.expenses, ndigits=2)
        savings_rate = round(number=net / entry.income * 100, ndigits=2) if entry.income > 0 else 0.0
        result.append(MonthlyNetSavings(month=entry.month, net=net, savings_rate=savings_rate))
    logger.debug(f"Computed monthly net/savings over {len(result)} month(s) for {user}")
    return result


def top_other_parties(
    *,
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    direction: StatisticsDirection,
    categories: list[TransactionCategory],
    limit: int = DEFAULT_TOP_OTHER_PARTIES_LIMIT,
) -> list[OtherPartySlice]:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    if not owned_account_ids:
        return []

    total = func.sum(Transaction.amount)
    rows = db_session.execute(
        select(Transaction.other_party, total)  # noqa: FKA100
        .where(
            *_base_conditions(
                account_ids=owned_account_ids, date_from=date_from, date_to=date_to, categories=categories
            )
        )
        .where(_direction_condition(direction))
        # Other party must be known — NULL and empty-string both render as a misleading blank bar, so drop them
        .where(Transaction.other_party.isnot(None))
        .where(Transaction.other_party != "")
        .group_by(Transaction.other_party)
        .order_by(func.abs(total).desc())
        .limit(limit)
    ).all()
    slices = [
        OtherPartySlice(other_party=other_party, total=round(number=abs(amount), ndigits=2))
        for other_party, amount in rows
    ]
    logger.debug(f"Computed top {len(slices)} {direction} other parties for {user}")
    return slices
