from source.bank_handlers.base import BankHandler


class INGBankHandler(BankHandler):
    def __init__(self, name: str):
        super().__init__(name)
