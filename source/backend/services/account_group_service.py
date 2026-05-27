from source.backend.api.schemas.account_group import AccountGroupLayoutWrite
from source.backend.exceptions import (
    AccountNotFoundError,
    NotFoundError,
    ValidationError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.account_group import AccountGroup
from source.backend.models.credential import Credential
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


class AccountGroupNotFoundError(NotFoundError):
    pass


def list_groups_for_user(db_session: Session, user_id: int) -> list[AccountGroup]:
    statement = (
        select(AccountGroup)  # noqa: FKA100
        .where(AccountGroup.user_id == user_id)
        .order_by(AccountGroup.position, AccountGroup.id)
    )
    rows = list(db_session.scalars(statement))
    logger.debug(f"Found {len(rows)} account group(s) for user {user_id}")
    return rows


def list_ungrouped_accounts_for_user(db_session: Session, user_id: int) -> list[Account]:
    statement = (
        select(Account)  # noqa: FKA100
        .join(Credential, Account.credential_id == Credential.id)
        .where(Credential.user_id == user_id, Account.group_id.is_(None))
        .order_by(Account.position, Account.id)
    )
    return list(db_session.scalars(statement))


def replace_layout(db_session: Session, user_id: int, payload: AccountGroupLayoutWrite) -> None:
    existing_groups = {group.id: group for group in list_groups_for_user(db_session=db_session, user_id=user_id)}
    user_account_ids = _user_account_ids(db_session=db_session, user_id=user_id)
    _validate_account_ownership(payload=payload, user_account_ids=user_account_ids)
    _validate_no_duplicate_account_ids(payload=payload)

    incoming_ids = {incoming.id for incoming in payload.groups if incoming.id is not None}
    unknown = incoming_ids - existing_groups.keys()
    if unknown:
        raise AccountGroupNotFoundError(f"Unknown group id(s) for user {user_id}: {sorted(unknown)}")

    # Resolve / create the AccountGroup rows in the order they appear in the payload.
    target_groups: list[AccountGroup] = []
    for position, incoming in enumerate(payload.groups):
        if incoming.id is None:
            group = AccountGroup(user_id=user_id, name=incoming.name.strip(), position=position)
            db_session.add(group)
        else:
            group = existing_groups[incoming.id]
            group.name = incoming.name.strip()
            group.position = position
        target_groups.append(group)

    accounts_by_id = {
        account.id: account
        for account in db_session.scalars(
            select(Account).where(Account.credential_id.in_(_credential_ids(db_session=db_session, user_id=user_id)))
        )
    }
    for group, incoming in zip(target_groups, payload.groups, strict=True):
        for position, account_id in enumerate(incoming.account_ids):
            account = accounts_by_id[account_id]
            account.group = group
            account.position = position

    for position, account_id in enumerate(payload.ungrouped):
        account = accounts_by_id[account_id]
        account.group = None
        account.position = position

    groups_to_delete = [group for group_id, group in existing_groups.items() if group_id not in incoming_ids]
    for group in groups_to_delete:
        db_session.delete(group)

    db_session.flush()
    logger.info(
        f"User {user_id} layout: {len(target_groups)} group(s) "
        f"({sum(1 for g in payload.groups if g.id is None)} created, {len(groups_to_delete)} deleted), "
        f"{len(payload.ungrouped)} ungrouped account(s)"
    )


def _user_account_ids(db_session: Session, user_id: int) -> set[int]:
    statement = (
        select(Account.id)  # noqa: FKA100
        .join(Credential, Account.credential_id == Credential.id)
        .where(Credential.user_id == user_id)
    )
    return set(db_session.scalars(statement))


def _credential_ids(db_session: Session, user_id: int) -> list[int]:
    return list(db_session.scalars(select(Credential.id).where(Credential.user_id == user_id)))


def _validate_account_ownership(payload: AccountGroupLayoutWrite, user_account_ids: set[int]) -> None:
    listed: set[int] = set(payload.ungrouped)
    for group in payload.groups:
        listed.update(group.account_ids)
    foreign = listed - user_account_ids
    if foreign:
        raise AccountNotFoundError(f"Account id(s) not owned by user: {sorted(foreign)}")


def _validate_no_duplicate_account_ids(payload: AccountGroupLayoutWrite) -> None:
    seen: set[int] = set()
    for group in payload.groups:
        for account_id in group.account_ids:
            if account_id in seen:
                raise ValidationError(f"Account {account_id} appears in more than one group")
            seen.add(account_id)
    for account_id in payload.ungrouped:
        if account_id in seen:
            raise ValidationError(f"Account {account_id} appears twice in the layout (grouped + ungrouped)")
        seen.add(account_id)


def serialize_layout(*, groups: list[AccountGroup], ungrouped_accounts: list[Account]) -> dict[str, object]:
    return {
        "groups": [
            {
                "id": group.id,
                "name": group.name,
                "accounts": [{"id": account.id} for account in group.accounts],
            }
            for group in groups
        ],
        "ungrouped": [{"id": account.id} for account in ungrouped_accounts],
    }
