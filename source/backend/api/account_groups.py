from fastapi import Depends
from source.backend.api.create_router import create_router
from source.backend.api.schemas.account_group import (
    AccountGroupLayoutRead,
    AccountGroupLayoutWrite,
)
from source.backend.db import get_session
from source.backend.models.user import User
from source.backend.services import account_group_service, session_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("/layout", response_model=AccountGroupLayoutRead)
def get_layout(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> dict:
    groups = account_group_service.list_groups_for_user(db_session=db_session, user=current_user)
    ungrouped = account_group_service.list_ungrouped_accounts_for_user(db_session=db_session, user=current_user)
    return account_group_service.serialize_layout(groups=groups, ungrouped_accounts=ungrouped)


@router.put("/layout", response_model=AccountGroupLayoutRead)
def set_layout(
    payload: AccountGroupLayoutWrite,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> dict:
    account_group_service.replace_layout(db_session=db_session, user=current_user, payload=payload)
    db_session.commit()
    db_session.expire_all()  # so subsequent reads see the freshly persisted positions
    groups = account_group_service.list_groups_for_user(db_session=db_session, user=current_user)
    ungrouped = account_group_service.list_ungrouped_accounts_for_user(db_session=db_session, user=current_user)
    return account_group_service.serialize_layout(groups=groups, ungrouped_accounts=ungrouped)
