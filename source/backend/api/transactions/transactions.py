from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from source.backend.api.accounts.account import detail_read
from source.backend.api.core.create_router import create_router
from source.backend.api.schemas.transactions.transaction import (
    TransactionDetailRead,
    TransactionRead,
    TransactionSearchQuery,
)
from source.backend.db import get_session
from source.backend.models.auth.user import User
from source.backend.services.accounts import account_service
from source.backend.services.auth import session_service

router = create_router()


@router.get("/search", response_model=list[TransactionRead])
def search_transactions(
    query: Annotated[TransactionSearchQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[TransactionRead]:
    transactions = account_service.get_filtered_transactions_for_user(
        db_session=db_session,
        user=current_user,
        account_ids_to_search_through=query.account_ids,
        filter_parameters=query.to_filter_parameters(),
    )
    reads = [TransactionRead.model_validate(transaction) for transaction in transactions]
    market_valued = account_service.market_valued_ids(
        db_session=db_session, account_ids=[transaction.account_id for transaction in transactions]
    )
    TransactionRead.flip_depot_signs(reads=reads, market_valued_account_ids=market_valued)
    return reads


@router.get("/{transaction_id}", response_model=TransactionDetailRead)
def get_transaction(
    transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> TransactionDetailRead:
    transaction = account_service.get_transaction_for_user(
        db_session=db_session, transaction_id=transaction_id, user=current_user
    )
    return detail_read(db_session=db_session, transaction=transaction)
