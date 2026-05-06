from source.bank_handlers.ing import INGBankHandler
from source.models.account import Account
from source.models.transaction import Transaction
from sqlalchemy.orm import Session

HANDLERS = {
    "INGBank_API": INGBankHandler,
}


def sync_account(session: Session, account: Account) -> Transaction:
    handler_cls = HANDLERS[account.merchant_name]
    raw = handler_cls(account.merchant_name).fetch_new_transactions()

    transaction = Transaction(amount=raw["amount"], timestamp=raw["timestamp"], account=account)
    account.balance += transaction.amount
    session.add(transaction)
    session.commit()
    return transaction
