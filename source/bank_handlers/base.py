from datetime import datetime


class BankHandler:
    def __init__(self, name: str):
        self.name = name

    def fetch_new_transactions(self) -> dict:
        return {"amount": 1, "timestamp": datetime.now()}
