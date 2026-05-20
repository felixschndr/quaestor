from fastapi import Depends, Query
from source.backend.api.create_router import create_router
from source.backend.api.schemas.account import (
    AccountHistory,
    AccountRead,
    AccountUpdate,
)
from source.backend.api.schemas.transaction import TransactionRead, TransactionUpdate
from source.backend.db import get_session
from source.backend.models.account import Account
from source.backend.models.transaction import Transaction
from source.backend.models.user import User
from source.backend.services import account_service, session_service
from sqlalchemy.orm import Session

router = create_router()


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Account:
    account = account_service.get_account_for_user(
        db_session=db_session, account_id=account_id, user_id=current_user.id
    )
    return account_service.update_account(
        db_session=db_session, account=account, fields=payload.model_dump(exclude_unset=True)
    )


@router.get("/{account_id}/transactions/{transaction_id}", response_model=TransactionRead)
def get_transaction(
    account_id: int,
    transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(
        db_session=db_session, account_id=account_id, user_id=current_user.id
    )
    return account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )


@router.patch("/{account_id}/transactions/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    account_id: int,
    transaction_id: int,
    payload: TransactionUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(
        db_session=db_session, account_id=account_id, user_id=current_user.id
    )
    transaction = account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )
    return account_service.update_transaction(
        db_session=db_session, transaction=transaction, fields=payload.model_dump(exclude_unset=True)
    )


@router.get("/{account_id}/history", response_model=AccountHistory)
def get_account_history(
    account_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=account_service.DEFAULT_DAYS_PER_PAGE, ge=1, le=account_service.MAX_DAYS_PER_PAGE),
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> AccountHistory:
    account_service.get_account_for_user(db_session=db_session, account_id=account_id, user_id=current_user.id)
    transactions, balance_at_date, total_days = account_service.get_history_page(
        db_session=db_session, account_id=account_id, page=page, page_size=page_size
    )
    return AccountHistory(
        transactions=[TransactionRead.model_validate(transaction) for transaction in transactions],
        balance_at_date=balance_at_date,
        page=page,
        page_size=page_size,
        total_days=total_days,
    )
