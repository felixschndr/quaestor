from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.models.transaction import Transaction


def get_key_of_transaction(transaction: Transaction | FetchedTransaction) -> str:
    return (
        f"{transaction.date} {transaction.purpose} {transaction.other_party} {transaction.amount} "
        f"{transaction.portfolio_transaction_type}"
    )
