from source.bank_handlers import HANDLERS
from source.models.account import Account
from source.models.transaction import Transaction
from sqlalchemy.orm import Session


def sync_account(session: Session, account: Account) -> Transaction:
    handler = HANDLERS[account.provider](account.provider.value)
    raw = handler.fetch_new_transactions()

    transaction = Transaction(amount=raw["amount"], timestamp=raw["timestamp"], account=account)
    account.balance += transaction.amount
    session.add(transaction)
    session.commit()
    return transaction
