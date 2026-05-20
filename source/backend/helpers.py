from datetime import date, datetime, timezone

from source.backend.bank_handlers.base import FetchedTransaction
from source.backend.models.transaction import Transaction


def get_key_of_transaction(transaction: Transaction | FetchedTransaction) -> str:
    return (
        f"{transaction.date} {transaction.purpose} {transaction.other_party} {transaction.amount} "
        f"{transaction.transaction_type}"
    )


def epoch_ms_to_date(value: str | int) -> date:
    return datetime.fromtimestamp(timestamp=int(value) / 1000, tz=timezone.utc).date()
