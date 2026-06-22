from typing import Annotated

from fastapi import Depends, Query
from source.backend.api.create_router import create_router
from source.backend.api.schemas.statistics import (
    CategorySlice,
    DirectionalStatisticsQuery,
    MonthlyCashflow,
    MonthlyNetSavings,
    NetWorthQuery,
    NetWorthRangeQuery,
    NetWorthRangeResponse,
    NetWorthResponse,
    OtherPartySlice,
    OtherPartyStatisticsQuery,
    StatisticsQuery,
)
from source.backend.db import get_session
from source.backend.models.user import User
from source.backend.services import session_service, statistics_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("/categories", response_model=list[CategorySlice])
def category_statistics(
    query: Annotated[DirectionalStatisticsQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[CategorySlice]:
    return statistics_service.category_breakdown(
        db_session=db_session,
        user=current_user,
        account_ids=query.account_ids,
        date_from=query.date_from,
        date_to=query.date_to,
        categories=query.categories,
        direction=query.direction,
        transaction_types=query.transaction_types,
        linked=query.linked,
    )


@router.get("/cashflow", response_model=list[MonthlyCashflow])
def cashflow_statistics(
    query: Annotated[StatisticsQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[MonthlyCashflow]:
    return statistics_service.monthly_cashflow(
        db_session=db_session,
        user=current_user,
        account_ids=query.account_ids,
        date_from=query.date_from,
        date_to=query.date_to,
        categories=query.categories,
        transaction_types=query.transaction_types,
        linked=query.linked,
    )


@router.get("/net-savings", response_model=list[MonthlyNetSavings])
def net_savings_statistics(
    query: Annotated[StatisticsQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[MonthlyNetSavings]:
    return statistics_service.monthly_net_savings(
        db_session=db_session,
        user=current_user,
        account_ids=query.account_ids,
        date_from=query.date_from,
        date_to=query.date_to,
        categories=query.categories,
        transaction_types=query.transaction_types,
        linked=query.linked,
    )


@router.get("/other-parties", response_model=list[OtherPartySlice])
def other_party_statistics(
    query: Annotated[OtherPartyStatisticsQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[OtherPartySlice]:
    return statistics_service.top_other_parties(
        db_session=db_session,
        user=current_user,
        account_ids=query.account_ids,
        date_from=query.date_from,
        date_to=query.date_to,
        categories=query.categories,
        direction=query.direction,
        transaction_types=query.transaction_types,
        linked=query.linked,
        limit=query.limit,
    )


@router.get("/net-worth", response_model=NetWorthResponse)
def net_worth_statistics(
    query: Annotated[NetWorthQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> NetWorthResponse:
    return statistics_service.daily_net_worth(
        db_session=db_session,
        user=current_user,
        account_ids=query.account_ids,
        date_from=query.date_from,
        date_to=query.date_to,
    )


@router.get("/net-worth/range", response_model=NetWorthRangeResponse)
def net_worth_range_statistics(
    query: Annotated[NetWorthRangeQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> NetWorthRangeResponse:
    return statistics_service.get_net_worth_of_range(
        db_session=db_session,
        user=current_user,
        account_ids=query.account_ids,
        start=query.start,
        end=query.end,
    )
