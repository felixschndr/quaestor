from contextlib import contextmanager
from typing import Iterator

from source.bank_handlers.base import BankHandler, BankSession, FetchedAccount


class _DFSSession(BankSession):
    def __init__(self, mandat: str, customer: str):
        self._mandat = mandat
        self._customer = customer

    def get_accounts(self) -> list[FetchedAccount]:
        # TODO
        return []

    def get_balance(self, account: FetchedAccount) -> float:
        # TODO
        return 0.0


class DFSHandler(BankHandler):
    EXTRA_CREDENTIAL_FIELDS = ("mandat", "customer")

    @contextmanager
    def session(self) -> Iterator[_DFSSession]:
        yield _DFSSession(mandat=self.extra["mandat"], customer=self.extra["customer"])
