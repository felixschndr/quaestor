from source.bank_handlers import BankProvider
from source.models.account import Account
from source.services import user_service
from sqlalchemy import select
from sqlalchemy.orm import Session


def list_accounts(session: Session, user_id: int) -> list[Account]:
    return list(session.scalars(select(Account).where(Account.user_id == user_id)))


def create_account(
    session: Session,
    user_id: int,
    provider: BankProvider,
    username: str,
    password: str,
) -> Account:
    user = user_service.get_user(session, user_id)
    account = Account(
        user=user,
        provider=provider,
        username=username,
        password=password,
    )
    session.add(account)
    session.commit()
    return account


def sync_accounts(session: Session, user_id: int) -> None:
    accounts = list_accounts(session=session, user_id=user_id)
    for account in accounts:
        account.sync()
