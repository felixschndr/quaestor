from fastapi import Depends
from sqlalchemy.orm import Session

from source.backend.api.core.create_router import create_router
from source.backend.api.schemas.transactions.categorization import (
    CategorizationRead,
    CategoryRuleIn,
    CategoryRuleRead,
    CustomCategoriesRead,
    CustomCategoryIn,
    CustomCategoryRead,
    DefaultMatcherRead,
    DefaultMatcherToggle,
)
from source.backend.db import get_session
from source.backend.models.auth.user import User
from source.backend.services.auth import session_service
from source.backend.services.transactions import categorization_service

router = create_router()


def _read(user: User, recategorized: int = 0) -> CategorizationRead:
    return CategorizationRead(
        rules=[CategoryRuleRead.model_validate(rule) for rule in user.category_rules],
        default_matchers=[
            DefaultMatcherRead.model_validate(matcher) for matcher in categorization_service.list_default_matchers(user)
        ],
        recategorized=recategorized,
    )


@router.get("", response_model=CategorizationRead)
def get_categorization(
    current_user: User = Depends(session_service.get_current_user_from_request),
) -> CategorizationRead:
    return _read(current_user)


@router.post("/rules", response_model=CategorizationRead, status_code=201)
def create_category_rule(
    payload: CategoryRuleIn,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CategorizationRead:
    recategorized = categorization_service.create_rule(
        db_session=db_session, user=current_user, pattern=payload.pattern, category=payload.category
    )
    return _read(user=current_user, recategorized=recategorized)


@router.put("/rules/{rule_id}", response_model=CategorizationRead)
def update_category_rule(
    rule_id: int,
    payload: CategoryRuleIn,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CategorizationRead:
    recategorized = categorization_service.update_rule(
        db_session=db_session, user=current_user, rule_id=rule_id, pattern=payload.pattern, category=payload.category
    )
    return _read(user=current_user, recategorized=recategorized)


@router.delete("/rules/{rule_id}", response_model=CategorizationRead)
def delete_category_rule(
    rule_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CategorizationRead:
    recategorized = categorization_service.delete_rule(db_session=db_session, user=current_user, rule_id=rule_id)
    return _read(user=current_user, recategorized=recategorized)


def _read_custom_categories(db_session: Session, user: User, recategorized: int = 0) -> CustomCategoriesRead:
    return CustomCategoriesRead(
        custom_categories=[
            CustomCategoryRead.model_validate(custom_category)
            for custom_category in categorization_service.list_visible_custom_categories(
                db_session=db_session, user=user
            )
        ],
        recategorized=recategorized,
    )


@router.get("/custom-categories", response_model=CustomCategoriesRead)
def list_custom_categories(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CustomCategoriesRead:
    return _read_custom_categories(db_session=db_session, user=current_user)


@router.post("/custom-categories", response_model=CustomCategoriesRead, status_code=201)
def create_custom_category(
    payload: CustomCategoryIn,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CustomCategoriesRead:
    categorization_service.create_custom_category(
        db_session=db_session, user=current_user, group=payload.group, name=payload.name
    )
    return _read_custom_categories(db_session=db_session, user=current_user)


@router.put("/custom-categories/{key}", response_model=CustomCategoriesRead)
def update_custom_category(
    key: str,
    payload: CustomCategoryIn,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CustomCategoriesRead:
    recategorized = categorization_service.update_custom_category(
        db_session=db_session, user=current_user, key=key, group=payload.group, name=payload.name
    )
    return _read_custom_categories(db_session=db_session, user=current_user, recategorized=recategorized)


@router.delete("/custom-categories/{key}", response_model=CustomCategoriesRead)
def delete_custom_category(
    key: str,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CustomCategoriesRead:
    recategorized = categorization_service.delete_custom_category(db_session=db_session, user=current_user, key=key)
    return _read_custom_categories(db_session=db_session, user=current_user, recategorized=recategorized)


@router.put("/default-matchers", response_model=CategorizationRead)
def toggle_default_matcher(
    payload: DefaultMatcherToggle,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> CategorizationRead:
    recategorized = categorization_service.set_default_matcher_disabled(
        db_session=db_session, user=current_user, pattern=payload.pattern, disabled=payload.disabled
    )
    return _read(user=current_user, recategorized=recategorized)
