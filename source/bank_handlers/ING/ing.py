import random
from datetime import datetime

from source.bank_handlers.base import BankHandler, FetchedTransaction


class INGBankHandler(BankHandler):
    def get_balance(self) -> float:
        return random.random() * 10000  # nosec B311

    def fetch_new_transactions(self, last_synced_at: datetime | None) -> list[FetchedTransaction]:
        return [FetchedTransaction(amount=100, timestamp=datetime.now()) for _ in range(10)]
