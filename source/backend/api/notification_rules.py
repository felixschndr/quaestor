from typing import Annotated, Literal, Union

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from source.backend.api.create_router import create_router
from source.backend.db import get_session
from source.backend.models.notification_rule import (
    BalanceDirection,
    NotificationRule,
    NotificationTrigger,
)
from source.backend.models.transaction_category import TransactionCategory
from source.backend.models.transaction_type import TransactionType
from source.backend.models.user import User
from source.backend.services import notification_rule_service, session_service

router = create_router()


class _RuleInBase(BaseModel):
    enabled: bool = True
    include_content: bool = True
    name: str | None = None
    account_ids: list[int] = Field(min_length=1)


class ExpectedRuleIn(_RuleInBase):
    trigger: Literal["expected_transaction"]


class ContractOverdueRuleIn(_RuleInBase):
    trigger: Literal["contract_overdue"]


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
    Union[ExpectedRuleIn, ContractOverdueRuleIn, TransactionRuleIn, BalanceRuleIn],
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


def _columns(payload: ExpectedRuleIn | ContractOverdueRuleIn | TransactionRuleIn | BalanceRuleIn) -> dict:
    # Map a validated, trigger-specific payload onto the model's flat column set
    columns = {
        "enabled": payload.enabled,
        "include_content": payload.include_content,
        "name": payload.name,
        "trigger": NotificationTrigger(payload.trigger),
        "account_ids": payload.account_ids,
        "other_party_contains": None,
        "categories": [],
        "types": [],
        "min_amount": None,
        "max_amount": None,
        "threshold": None,
        "direction": None,
    }
    if isinstance(payload, TransactionRuleIn):
        columns.update(
            other_party_contains=payload.other_party_contains,
            categories=[category.value for category in payload.categories],
            types=[transaction_type.value for transaction_type in payload.types],
            min_amount=payload.min_amount,
            max_amount=payload.max_amount,
        )
    elif isinstance(payload, BalanceRuleIn):
        columns.update(threshold=payload.threshold, direction=payload.direction)
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
