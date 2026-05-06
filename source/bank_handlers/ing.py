from datetime import datetime

from source.bank_handlers.base import BankHandler, FetchedTransaction


class INGBankHandler(BankHandler):
    def fetch_new_transactions(self, last_synced_at: datetime | None) -> list[FetchedTransaction]:
        return [FetchedTransaction(amount=100, timestamp=datetime.now()) for _ in range(10)]
