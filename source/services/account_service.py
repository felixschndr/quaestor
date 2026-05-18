import logging

from source.exceptions import AccountNotFoundError
from source.models.account import Account
from source.models.credential import Credential
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


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
