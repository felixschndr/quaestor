from typing import Annotated, Literal, Union

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from source.backend.api.core.create_router import create_router
from source.backend.db import get_session
from source.backend.models.auth.user import User
from source.backend.models.contracts.contract import (
    DUPLICATE_WINDOW_DAYS,
    OVERDUE_GRACE_DAYS,
    SHORTFALL_LOOKAHEAD_DAYS,
)
from source.backend.models.notifications.notification_rule import (
    DEFAULT_DIGEST_WEEKDAY,
    BalanceDirection,
    DigestPeriod,
    NotificationRule,
    NotificationTrigger,
)
from source.backend.models.transactions.transaction_category import TransactionCategory
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.auth import session_service
from source.backend.services.notifications import notification_rule_service

router = create_router()


class _RuleInBase(BaseModel):
    enabled: bool = True
    include_content: bool = True
    name: str | None = None
    account_ids: list[int]  # empty = all accounts, including future ones


class ExpectedRuleIn(_RuleInBase):
    trigger: Literal["expected_transaction"]


class ContractOverdueRuleIn(_RuleInBase):
    trigger: Literal["contract_overdue"]
    days: int = Field(default=OVERDUE_GRACE_DAYS, ge=0, le=90)


class ContractAmountIncreasedRuleIn(_RuleInBase):
    trigger: Literal["contract_amount_increased"]


class DigestRuleIn(_RuleInBase):
    trigger: Literal["digest"]
    period: DigestPeriod
    weekday: int = Field(default=DEFAULT_DIGEST_WEEKDAY, ge=0, le=6)


class DuplicateTransactionRuleIn(_RuleInBase):
    trigger: Literal["duplicate_transaction"]
    days: int = Field(default=DUPLICATE_WINDOW_DAYS, ge=1, le=90)


class UpcomingShortfallRuleIn(_RuleInBase):
    trigger: Literal["upcoming_shortfall"]
    days: int = Field(default=SHORTFALL_LOOKAHEAD_DAYS, ge=1, le=90)


class TransactionRuleIn(_RuleInBase):
    trigger: Literal["transaction"]
    other_party_contains: str | None = None
    categories: list[TransactionCategory]
    types: list[TransactionType]
    min_amount: float | None = None
    max_amount: float | None = None


class BalanceRuleIn(_RuleInBase):
    trigger: Literal["balance_threshold"]
    threshold: float
    direction: BalanceDirection


RuleIn = Annotated[
    Union[
        ExpectedRuleIn,
        ContractOverdueRuleIn,
        ContractAmountIncreasedRuleIn,
        DuplicateTransactionRuleIn,
        DigestRuleIn,
        UpcomingShortfallRuleIn,
        TransactionRuleIn,
        BalanceRuleIn,
    ],
    Field(discriminator="trigger"),
]


class RuleRead(BaseModel):
    # One flat shape for all triggers; fields irrelevant to a trigger stay null/empty
    model_config = ConfigDict(from_attributes=True)

    id: int
    enabled: bool
    include_content: bool
    name: str | None
    trigger: NotificationTrigger
    account_ids: list[int]
    other_party_contains: str | None = None
    categories: list[TransactionCategory] = []
    types: list[TransactionType] = []
    min_amount: float | None = None
    max_amount: float | None = None
    threshold: float | None = None
    direction: BalanceDirection | None = None
    days: int | None = None
    period: DigestPeriod | None = None
    weekday: int | None = None


_RULE_DEFAULTS = {
    "other_party_contains": None,
    "categories": [],
    "types": [],
    "min_amount": None,
    "max_amount": None,
    "threshold": None,
    "direction": None,
    "days": None,
    "period": None,
    "weekday": None,
}


def _columns(
    payload: (
        ExpectedRuleIn
        | ContractOverdueRuleIn
        | ContractAmountIncreasedRuleIn
        | DuplicateTransactionRuleIn
        | DigestRuleIn
        | UpcomingShortfallRuleIn
        | TransactionRuleIn
        | BalanceRuleIn
    ),
) -> dict:
    columns = _RULE_DEFAULTS | payload.model_dump(mode="json")
    columns["trigger"] = NotificationTrigger(payload.trigger)
    if columns["period"] is not None:
        columns["period"] = DigestPeriod(columns["period"])
    if columns["direction"] is not None:
        columns["direction"] = BalanceDirection(columns["direction"])
    return columns


@router.post("", response_model=RuleRead, status_code=201)
def create_notification_rule(
    payload: RuleIn,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> NotificationRule:
    return notification_rule_service.create_rule(db_session=db_session, user=current_user, fields=_columns(payload))


@router.get("", response_model=list[RuleRead])
def list_notification_rules(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[NotificationRule]:
    return notification_rule_service.list_rules(db_session=db_session, user=current_user)


@router.put("/{rule_id}", response_model=RuleRead)
def update_notification_rule(
    rule_id: int,
    payload: RuleIn,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> NotificationRule:
    rule = notification_rule_service.get_rule_for_user(db_session=db_session, rule_id=rule_id, user=current_user)
    return notification_rule_service.update_rule(
        db_session=db_session, user=current_user, rule=rule, fields=_columns(payload)
    )


@router.delete("/{rule_id}", status_code=204)
def delete_notification_rule(
    rule_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    rule = notification_rule_service.get_rule_for_user(db_session=db_session, rule_id=rule_id, user=current_user)
    notification_rule_service.delete_rule(db_session=db_session, rule=rule)
