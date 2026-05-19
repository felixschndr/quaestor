from source.backend.exceptions import AccountNotFoundError
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.credential import Credential
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


def list_accounts(db_session: Session, user_id: int) -> list[Account]:
    stmt = (
        select(Account)
        .join(Credential, onclause=Account.credential_id == Credential.id)
        .where(Credential.user_id == user_id)
    )
    accounts = list(db_session.scalars(stmt))
    logger.debug(f"Found {len(accounts)} account(s) for user {user_id}")
    return accounts


def get_account(db_session: Session, account_id: int) -> Account:
    account = db_session.get(entity=Account, ident=account_id)
    if account is None:
        error_message = f"Account with the ID {account_id} not found"
        logger.warning(error_message)
        raise AccountNotFoundError(error_message)
    logger.debug(f"Loaded account with the ID {account_id}")
    return account


def get_account_for_user(db_session: Session, account_id: int, user_id: int) -> Account:
    account = get_account(db_session=db_session, account_id=account_id)
    if account.credential.user_id != user_id:
        logger.warning(
            f"User {user_id} attempted to access account {account_id} owned by user {account.credential.user_id}"
        )
        raise AccountNotFoundError(f"Account with the ID {account_id} not found")
    return account
