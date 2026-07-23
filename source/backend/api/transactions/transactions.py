from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from source.backend.api.core.create_router import create_router
from source.backend.api.schemas.transactions.transaction import TransactionRead, TransactionSearchQuery
from source.backend.db import get_session
from source.backend.models.auth.user import User
from source.backend.models.transactions.transaction import Transaction
from source.backend.services.accounts import account_service
from source.backend.services.auth import session_service

router = create_router()


@router.get("/search", response_model=list[TransactionRead])
def search_transactions(
    query: Annotated[TransactionSearchQuery, Query()],
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[Transaction]:
    return account_service.get_filtered_transactions_for_user(
        db_session=db_session,
        user=current_user,
        account_ids_to_search_through=query.account_ids,
        filter_parameters=query.to_filter_parameters(),
    )
