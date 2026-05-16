from contextlib import contextmanager
from typing import Iterator

from source.bank_handlers.base import BankHandler, BankSession, FetchedAccount


class _DFSSession(BankSession):
    def get_accounts(self) -> list[FetchedAccount]:
        # TODO
        return []

    def get_balance(self, account: FetchedAccount) -> float:
        # TODO
        return 0.0


class DFSHandler(BankHandler):
    @contextmanager
    def session(self) -> Iterator[_DFSSession]:
        yield _DFSSession()
