from fastapi import Depends
from sqlalchemy.orm import Session

from source.backend.api.core.create_router import create_router
from source.backend.api.schemas.accounts.account import AccountRead
from source.backend.api.schemas.auth.user import (
    AccountSharePermissionUpdate,
    AccountShareRecipientRead,
    AccountShareSettingsUpdate,
    AccountShareWrite,
    ShareableUserRead,
)
from source.backend.db import get_session
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_share import AccountShare, SharedAccountView, shared_account_view
from source.backend.models.auth.user import User
from source.backend.services.accounts import account_service, account_share_service
from source.backend.services.auth import session_service

router = create_router()


def _own_account(db_session: Session, account_id: int, user: User) -> Account:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=user)
    return account_service.require_owned_account(account=account, user=user)


def _own_share(db_session: Session, share_id: int, user: User) -> AccountShare:
    share = db_session.get(entity=AccountShare, ident=share_id)
    if share is None:
        raise account_share_service.AccountShareNotFoundError(f"Share with the ID {share_id} not found")
    account_service.require_owned_account(account=share.account, user=user)
    return share


@router.get("/users", response_model=list[ShareableUserRead])
def list_shareable_users(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[User]:
    return account_share_service.list_shareable_users(db_session=db_session, user=current_user)


@router.get("/account/{account_id}", response_model=list[AccountShareRecipientRead])
def list_shares(
    account_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list:
    account = _own_account(db_session=db_session, account_id=account_id, user=current_user)
    return [account_share_service.recipient_view(share) for share in account.shares]


@router.post("/account/{account_id}", response_model=AccountShareRecipientRead, status_code=201)
def share_account(
    account_id: int,
    payload: AccountShareWrite,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> AccountShareRecipientRead:
    account = _own_account(db_session=db_session, account_id=account_id, user=current_user)
    share = account_share_service.share_account(
        db_session=db_session,
        account=account,
        owner=current_user,
        recipient_id=payload.user_id,
        permission=payload.permission,
    )
    return account_share_service.recipient_view(share)


@router.patch("/{share_id}", response_model=AccountShareRecipientRead)
def update_share_permission(
    share_id: int,
    payload: AccountSharePermissionUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> AccountShareRecipientRead:
    share = _own_share(db_session=db_session, share_id=share_id, user=current_user)
    account_share_service.update_permission(db_session=db_session, share=share, permission=payload.permission)
    return account_share_service.recipient_view(share)


@router.delete("/{share_id}", status_code=204)
def revoke_share(
    share_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    share = _own_share(db_session=db_session, share_id=share_id, user=current_user)
    account_share_service.revoke(db_session=db_session, share=share)


@router.post("/{share_id}/accept", status_code=204)
def accept_invitation(
    share_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account_share_service.respond_to_invitation(
        db_session=db_session, user=current_user, share_id=share_id, accept=True
    )


@router.post("/{share_id}/decline", status_code=204)
def decline_invitation(
    share_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account_share_service.respond_to_invitation(
        db_session=db_session, user=current_user, share_id=share_id, accept=False
    )


@router.patch("/account/{account_id}/mine", response_model=AccountRead)
def update_own_share_settings(
    account_id: int,
    payload: AccountShareSettingsUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> SharedAccountView:
    share = account_share_service.get_own_share(user=current_user, account_id=account_id)
    account_share_service.update_own_settings(
        db_session=db_session, share=share, fields=payload.model_dump(exclude_unset=True)
    )
    return shared_account_view(share)


@router.delete("/account/{account_id}/mine", status_code=204)
def leave_share(
    account_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account_share_service.leave(db_session=db_session, user=current_user, account_id=account_id)
