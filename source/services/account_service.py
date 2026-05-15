from source.exceptions import AccountNotFoundError
from source.models.account import Account
from source.models.credential import Credential
from sqlalchemy import select
from sqlalchemy.orm import Session


def list_accounts(session: Session, user_id: int) -> list[Account]:
    """All accounts a user owns, across every credential."""
    stmt = select(Account).join(Credential, Account.credential_id == Credential.id).where(Credential.user_id == user_id)
    return list(session.scalars(stmt))


def get_account(session: Session, account_id: int) -> Account:
    account = session.get(Account, account_id)
    if account is None:
        raise AccountNotFoundError(f"Account with the id {account_id} not found")
    return account
