import datetime

from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.orm import Session

from source.backend.api.schemas.transactions.statistics import (
    AccountRangeChange,
    CategorySlice,
    DailyNetWorth,
    MonthlyCashflow,
    MonthlyNetSavings,
    NetWorthRangeResponse,
    NetWorthResponse,
    NetWorthSummary,
    OtherPartySlice,
    StatisticsDirection,
    StatisticsLinked,
    TransactionCountBucket,
    TransactionCountsGroupBy,
)
from source.backend.api.schemas.transactions.transaction import TransactionRead
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_balance_snapshot import (
    AccountBalanceSnapshot,
)
from source.backend.models.auth.user import User
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.accounts import account_service

logger = get_logger(__name__)

DEFAULT_TOP_OTHER_PARTIES_LIMIT = 15


def _base_conditions(
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
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
    if transaction_types:
        conditions.append(Transaction.transaction_type.in_(transaction_types))
    if linked is not None:
        if linked == "linked":
            conditions.append(Transaction.transfer_counterpart_id.isnot(None))
        else:
            conditions.append(Transaction.transfer_counterpart_id.is_(None))
    return conditions


def _direction_condition(direction: StatisticsDirection) -> ColumnElement[bool]:
    if direction == "OUTGOING":
        return Transaction.amount < 0
    return Transaction.amount > 0


def category_breakdown(
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    direction: StatisticsDirection,
    categories: list[TransactionCategory],
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
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
                account_ids=owned_account_ids,
                date_from=date_from,
                date_to=date_to,
                categories=categories,
                transaction_types=transaction_types,
                linked=linked,
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
    db_session: Session,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
) -> list[MonthlyCashflow]:
    month = func.strftime("%Y-%m", Transaction.date)  # noqa: FKA100
    income = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0.0))
    expenses = func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0.0))
    rows = db_session.execute(
        select(month, income, expenses)  # noqa: FKA100
        .where(
            *_base_conditions(
                account_ids=account_ids,
                date_from=date_from,
                date_to=date_to,
                categories=categories,
                transaction_types=transaction_types,
                linked=linked,
            )
        )
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
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
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
        transaction_types=transaction_types,
        linked=linked,
    )
    logger.debug(f"Computed monthly cashflow over {len(cashflow)} month(s) for {user}")
    return cashflow


def monthly_net_savings(
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
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
        transaction_types=transaction_types,
        linked=linked,
    )
    result = []
    for entry in cashflow:
        net = round(number=entry.income - entry.expenses, ndigits=2)
        savings_rate = round(number=net / entry.income * 100, ndigits=2) if entry.income > 0 else 0.0
        result.append(MonthlyNetSavings(month=entry.month, net=net, savings_rate=savings_rate))
    logger.debug(f"Computed monthly net/savings over {len(result)} month(s) for {user}")
    return result


def _count_bucket_expression(group_by: TransactionCountsGroupBy) -> ColumnElement[str]:
    if group_by == "week":
        # Monday of the transaction's week: advance to the next Sunday (or stay on one), then step back six days
        return func.date(Transaction.date, "weekday 0", "-6 days")  # noqa: FKA100
    patterns = {"day": "%Y-%m-%d", "month": "%Y-%m", "weekday": "%w"}
    return func.strftime(patterns[group_by], Transaction.date)  # noqa: FKA100


def transaction_counts(
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    categories: list[TransactionCategory],
    group_by: TransactionCountsGroupBy,
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
) -> list[TransactionCountBucket]:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    if not owned_account_ids:
        return []

    bucket = _count_bucket_expression(group_by)
    rows = db_session.execute(
        select(bucket, func.count())  # noqa: FKA100
        .where(
            *_base_conditions(
                account_ids=owned_account_ids,
                date_from=date_from,
                date_to=date_to,
                categories=categories,
                transaction_types=transaction_types,
                linked=linked,
            )
        )
        .group_by(bucket)
        .order_by(bucket)
    ).all()
    buckets = [TransactionCountBucket(bucket=bucket_value, count=count) for bucket_value, count in rows]
    logger.debug(f"Computed {len(buckets)} transaction count buckets per {group_by} for {user}")
    return buckets


def top_other_parties(
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    direction: StatisticsDirection,
    categories: list[TransactionCategory],
    transaction_types: list[TransactionType] | None = None,
    linked: StatisticsLinked | None = None,
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
                account_ids=owned_account_ids,
                date_from=date_from,
                date_to=date_to,
                categories=categories,
                transaction_types=transaction_types,
                linked=linked,
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


def daily_net_worth(
    db_session: Session,
    user: User,
    account_ids: list[int],
    date_from: datetime.date | None,
    date_to: datetime.date | None,
) -> NetWorthResponse:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    if not owned_account_ids:
        return NetWorthResponse(series=[])

    today = datetime.date.today()
    end_date = min(date_to, today) if date_to is not None else today

    accounts = list(db_session.scalars(select(Account).where(Account.id.in_(owned_account_ids))))  # noqa: FKA100
    balance_factors = {account.id: account.balance_factor for account in accounts}
    live_balances = {account.id: account.balance for account in accounts}

    # When the caller didn't pin the start, anchor to the earliest snapshot across selected accounts
    if date_from is None:
        earliest = db_session.scalar(
            select(func.min(AccountBalanceSnapshot.date)).where(
                AccountBalanceSnapshot.account_id.in_(owned_account_ids)
            )
        )
        if earliest is None:
            return NetWorthResponse(series=[])
        date_from = earliest

    if end_date < date_from:
        return NetWorthResponse(series=[])

    in_range_snapshots = list(
        db_session.scalars(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id.in_(owned_account_ids))
            .where(AccountBalanceSnapshot.date >= date_from)
            .where(AccountBalanceSnapshot.date <= end_date)
            .order_by(AccountBalanceSnapshot.date)
        )
    )
    per_account_steps: dict[int, list[tuple[datetime.date, float]]] = {
        account_id: [] for account_id in owned_account_ids
    }
    for snapshot in in_range_snapshots:
        per_account_steps[snapshot.account_id].append((snapshot.date, snapshot.balance))

    current_balance: dict[int, float | None] = dict.fromkeys(owned_account_ids)
    for account_id in owned_account_ids:
        anchor = db_session.scalar(
            select(AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .where(AccountBalanceSnapshot.date < date_from)
            .order_by(AccountBalanceSnapshot.date.desc())
            .limit(1)
        )
        current_balance[account_id] = anchor

    step_indices: dict[int, int] = dict.fromkeys(owned_account_ids, 0)  # noqa: FKA100
    result: list[DailyNetWorth] = []
    day = date_from
    one_day = datetime.timedelta(days=1)
    while day <= end_date:
        for account_id, steps in per_account_steps.items():
            index = step_indices[account_id]
            while index < len(steps) and steps[index][0] <= day:
                current_balance[account_id] = steps[index][1]
                index += 1
            step_indices[account_id] = index

        day_balances = live_balances if day == today else current_balance
        if any(balance is not None for balance in day_balances.values()):
            net = sum(
                (balance or 0.0) * balance_factors[account_id] / 100 for account_id, balance in day_balances.items()
            )
            result.append(DailyNetWorth(date=day, value=round(number=net, ndigits=2)))
        day += one_day

    logger.debug(f"Computed daily net worth over {len(result)} day(s) for {user}")
    summary = _net_worth_summary(result)
    return NetWorthResponse(series=result, summary=summary)


def _get_balance_as_of(db_session: Session, account_id: int, cutoff: datetime.date) -> float | None:
    return db_session.scalar(
        select(AccountBalanceSnapshot.balance)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .where(AccountBalanceSnapshot.date <= cutoff)
        .order_by(AccountBalanceSnapshot.date.desc())
        .limit(1)
    )


def _balance_at_end_of(db_session: Session, account: Account, cutoff: datetime.date) -> float | None:
    if cutoff >= datetime.date.today():
        return account.balance
    return _get_balance_as_of(db_session=db_session, account_id=account.id, cutoff=cutoff)


def get_net_worth_of_range(
    db_session: Session,
    user: User,
    account_ids: list[int],
    start: datetime.date,
    end: datetime.date,
) -> NetWorthRangeResponse:
    owned_account_ids = account_service.resolve_owned_account_ids(
        db_session=db_session, user=user, account_ids=account_ids
    )
    accounts_by_id = {
        account.id: account
        for account in db_session.scalars(select(Account).where(Account.id.in_(owned_account_ids)))  # noqa: FKA100
    }
    changes: list[AccountRangeChange] = []
    total_at_start = 0.0
    total_at_end = 0.0
    for account_id in owned_account_ids:
        account = accounts_by_id[account_id]
        before = _balance_at_end_of(db_session=db_session, account=account, cutoff=start)
        after = _balance_at_end_of(db_session=db_session, account=account, cutoff=end)
        transactions = list(
            db_session.scalars(
                select(Transaction)
                .where(Transaction.account_id == account_id)
                .where(Transaction.date > start)
                .where(Transaction.date <= end)
                .where(Transaction.pending.is_(False))
                .order_by(Transaction.date.desc())
                .order_by(Transaction.id.desc())
            )
        )
        changes.append(
            AccountRangeChange(
                account_id=account_id,
                balance_at_start=before,
                balance_at_end=after,
                difference=round(number=(after or 0.0) - (before or 0.0), ndigits=2),
                transactions=[TransactionRead.model_validate(transaction) for transaction in transactions],
            )
        )
        total_at_start += before or 0.0
        total_at_end += after or 0.0

    logger.debug(f"Computed net worth breakdown for {start}..{end} over {len(changes)} account(s) for {user}")
    return NetWorthRangeResponse(
        start=start,
        end=end,
        accounts=changes,
        total_at_start=round(number=total_at_start, ndigits=2),
        total_at_end=round(number=total_at_end, ndigits=2),
        total_difference=round(number=total_at_end - total_at_start, ndigits=2),
    )


def _net_worth_summary(series: list[DailyNetWorth]) -> NetWorthSummary | None:
    if not series:
        return None
    values = [datum.value for datum in series]
    average = round(number=sum(values) / len(values), ndigits=2)
    return NetWorthSummary(minimum=min(values), average=average, maximum=max(values))
