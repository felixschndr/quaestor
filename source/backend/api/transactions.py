from fastapi import Depends, Query
from source.backend.api.create_router import create_router
from source.backend.api.schemas.transaction import TransactionPage, TransactionRead
from source.backend.db import get_session
from source.backend.models.user import User
from source.backend.services import (
    account_service,
    session_service,
    transaction_service,
)
from sqlalchemy.orm import Session

router = create_router()


@router.get("/{account_id}", response_model=TransactionPage)
def list_transactions(
    account_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=transaction_service.DEFAULT_PAGE_SIZE, ge=1, le=transaction_service.MAX_PAGE_SIZE),
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> TransactionPage:
    account_service.get_account_for_user(db_session=db_session, account_id=account_id, user_id=current_user.id)
    transactions, total = transaction_service.list_transactions(
        db_session=db_session, account_id=account_id, page=page, page_size=page_size
    )
    return TransactionPage(
        items=[TransactionRead.model_validate(transaction) for transaction in transactions],
        page=page,
        page_size=page_size,
        total=total,
    )
