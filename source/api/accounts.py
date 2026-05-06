from fastapi import APIRouter, Depends
from source.api.schemas import AccountCreate, AccountRead, AccountUpdate
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


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(account_id: int, payload: AccountUpdate, session: Session = Depends(get_session)) -> Account:
    return account_service.update_account(session, account_id, payload.model_dump(exclude_unset=True))


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, session: Session = Depends(get_session)) -> None:
    account_service.delete_account(session, account_id)
