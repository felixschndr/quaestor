from fastapi import APIRouter, Depends
from source.api.schemas import AccountCreate, AccountRead
from source.db import get_session
from source.models.account import Account
from source.services import account_service
from sqlalchemy.orm import Session

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("/{user_id}", response_model=list[AccountRead])
def list_accounts(user_id: int, session: Session = Depends(get_session)) -> list[Account]:
    return account_service.list_accounts(session, user_id=user_id)


@router.post("", response_model=AccountRead, status_code=201)
def create_account(payload: AccountCreate, session: Session = Depends(get_session)) -> Account:
    return account_service.create_account(
        session,
        user_id=payload.user_id,
        provider=payload.provider,
        username=payload.username,
        password=payload.password,
    )


@router.post("/sync/{user_id}", status_code=204)
def sync_accounts_of_user(user_id: int, session: Session = Depends(get_session)) -> None:
    accounts = account_service.list_accounts(session, user_id=user_id)
    for account in accounts:
        account.sync()
    session.commit()
