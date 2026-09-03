from sqlalchemy import select
from sqlalchemy.orm import Session

from source.backend.api.schemas.auth.user import AccountShareRecipientRead
from source.backend.exceptions import ConflictError, NotFoundError, UserNotFoundError, ValidationError
from source.backend.logging_utils import get_logger
from source.backend.models.accounts.account import Account
from source.backend.models.accounts.account_share import AccountShare, SharePermission, ShareStatus
from source.backend.models.auth.user import User
from source.backend.services.notifications import notification_messages, notification_service
from source.backend.services.notifications.notification_service import Notification

logger = get_logger(__name__)


class AccountShareNotFoundError(NotFoundError):
    pass


def _permission_label(permission: SharePermission, language: str) -> str:
    # Spelled out rather than built from the enum, so the i18n check can find the keys statically.
    key = "account_share.permission.read" if permission is SharePermission.READ else "account_share.permission.write"
    return notification_messages.translate(language=language, key=key)


def list_shareable_users(db_session: Session, user: User) -> list[User]:
    users = list(db_session.scalars(select(User).where(User.id != user.id).order_by(User.display_name)))
    logger.debug(f"Found {len(users)} user(s) {user} could share an account with")
    return users


def recipient_view(share: AccountShare) -> AccountShareRecipientRead:
    return AccountShareRecipientRead(
        id=share.id,
        user_id=share.user_id,
        display_name=share.user.display_name,
        permission=share.permission,
        status=share.status,
    )


def share_account(
    db_session: Session, account: Account, owner: User, recipient_id: int, permission: SharePermission
) -> AccountShare:
    if recipient_id == owner.id:
        raise ValidationError("An account cannot be shared with its owner")
    recipient = db_session.get(entity=User, ident=recipient_id)
    if recipient is None:
        raise UserNotFoundError(f"User with the ID {recipient_id} not found")
    if any(share.user_id == recipient_id for share in account.shares):
        raise ConflictError(f"{account} is already shared with {recipient}")

    share = AccountShare(account=account, user=recipient, permission=permission, status=ShareStatus.PENDING)
    db_session.add(share)
    db_session.commit()
    logger.info(f"{owner} invited {recipient} to {account} ({permission.value})")
    _notify(
        db_session=db_session,
        recipient=recipient,
        title_key="account_share.invited.title",
        body_key="account_share.invited.body",
        url="/settings",
        share_id=share.id,
        owner=owner.display_name,
        account=account.display_label,
        permission=_permission_label(permission=permission, language=recipient.language),
    )
    return share


def update_permission(db_session: Session, share: AccountShare, permission: SharePermission) -> AccountShare:
    share.permission = permission
    db_session.commit()
    logger.info(f"Set {share} to {permission.value}")
    _notify(
        db_session=db_session,
        recipient=share.user,
        title_key="account_share.permission_changed.title",
        body_key="account_share.permission_changed.body",
        url=f"/account/{share.account_id}",
        share_id=share.id,
        owner=share.account.credential.user.display_name,
        account=share.account.display_label,
        permission=_permission_label(permission=permission, language=share.user.language),
    )
    return share


def revoke(db_session: Session, share: AccountShare) -> None:
    recipient = share.user
    account = share.account
    share_id = share.id
    db_session.delete(share)
    db_session.commit()
    logger.info(f"Revoked the share of {account} with {recipient}")
    _notify(
        db_session=db_session,
        recipient=recipient,
        title_key="account_share.revoked.title",
        body_key="account_share.revoked.body",
        url="/settings",
        share_id=share_id,
        owner=account.credential.user.display_name,
        account=account.display_label,
    )


def respond_to_invitation(db_session: Session, user: User, share_id: int, accept: bool) -> None:
    share = db_session.get(entity=AccountShare, ident=share_id)
    if share is None or share.user_id != user.id:
        raise AccountShareNotFoundError(f"Share with the ID {share_id} not found")
    if share.status is not ShareStatus.PENDING:
        raise ConflictError(f"{share} has already been answered")
    account = share.account
    owner = account.credential.user
    if accept:
        share.status = ShareStatus.ACCEPTED
    else:
        # Declining drops the row so the owner can simply invite again.
        db_session.delete(share)
    db_session.commit()
    logger.info(f"{user} {'accepted' if accept else 'declined'} the share of {account}")
    _notify(
        db_session=db_session,
        recipient=owner,
        title_key="account_share.accepted.title" if accept else "account_share.declined.title",
        body_key="account_share.accepted.body" if accept else "account_share.declined.body",
        url=_owner_url(account=account),
        share_id=share_id,
        user=user.display_name,
        account=account.display_label,
    )


def get_own_share(user: User, account_id: int) -> AccountShare:
    share = next((share for share in user.accepted_shares if share.account_id == account_id), None)
    if share is None:
        raise AccountShareNotFoundError(f"{user} has no share for the account {account_id}")
    return share


def update_own_settings(db_session: Session, share: AccountShare, fields: dict) -> AccountShare:
    for name in ("balance_factor", "is_hidden", "include_by_default"):
        if fields.get(name) is not None:
            setattr(share, name, fields[name])
    if "display_name" in fields:
        share.display_name = fields["display_name"]
    db_session.commit()
    logger.info(f"Updated {share} for its recipient")
    return share


def leave(db_session: Session, user: User, account_id: int) -> None:
    share = get_own_share(user=user, account_id=account_id)
    account = share.account
    share_id = share.id
    db_session.delete(share)
    db_session.commit()
    logger.info(f"{user} left the share of {account}")
    _notify(
        db_session=db_session,
        recipient=account.credential.user,
        title_key="account_share.left.title",
        body_key="account_share.left.body",
        url=_owner_url(account=account),
        share_id=share_id,
        user=user.display_name,
        account=account.display_label,
    )


def _notify(
    db_session: Session, recipient: User, title_key: str, body_key: str, url: str, share_id: int, **params: object
) -> None:
    notification_service.notify_user(
        db_session=db_session,
        user=recipient,
        notification=Notification(
            title=notification_messages.translate(language=recipient.language, key=title_key),
            body=notification_messages.translate(language=recipient.language, key=body_key, **params),
            url=url,
            tag=f"account-share-{share_id}",
        ),
    )


def _owner_url(account: Account) -> str:
    return f"/settings/credentials/{account.credential_id}"
