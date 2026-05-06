from source.bank_handlers import BankProvider
from source.exceptions import AccountNotFoundError
from source.models.account import Account
from source.services import user_service
from sqlalchemy import select
from sqlalchemy.orm import Session


def list_accounts(session: Session, user_id: int) -> list[Account]:
    return list(session.scalars(select(Account).where(Account.user_id == user_id)))


def get_account(session: Session, account_id: int) -> Account:
    account = session.get(Account, account_id)
    if account is None:
        raise AccountNotFoundError(f"Account with the id {account_id} not found")
    return account


def create_account(session: Session, user_id: int, provider: BankProvider, username: str, password: str) -> Account:
    user = user_service.get_user(session, user_id)
    account = Account(user=user, provider=provider, username=username, password=password)
    session.add(account)
    session.commit()
    return account


def update_account(session: Session, account_id: int, fields: dict) -> Account:
    account = get_account(session, account_id)
    for key, value in fields.items():
        setattr(account, key, value)
    session.commit()
    return account


def delete_account(session: Session, account_id: int) -> None:
    account = get_account(session, account_id)
    session.delete(account)
    session.commit()


def sync_accounts(session: Session, user_id: int) -> None:
    accounts = list_accounts(session=session, user_id=user_id)
    for account in accounts:
        account.sync()
