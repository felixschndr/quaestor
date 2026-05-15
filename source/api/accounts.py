from fastapi import APIRouter, Depends
from source.api.schemas import AccountRead
from source.db import get_session
from source.models.account import Account
from source.services import account_service
from sqlalchemy.orm import Session

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/{user_id}", response_model=list[AccountRead])
def list_accounts(user_id: int, session: Session = Depends(get_session)) -> list[Account]:
    """Accounts are discovered via credentials, so they are read-only here."""
    return account_service.list_accounts(session, user_id=user_id)
