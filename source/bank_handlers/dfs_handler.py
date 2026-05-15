from source.bank_handlers.base import BankHandler, FetchedAccount


class DFSHandler(BankHandler):
    """Handler for DFS."""

    def get_accounts(self) -> list[FetchedAccount]:
        # TODO
        return []

    def get_balance(self, account: FetchedAccount) -> float:
        # TODO
        return 0.0
