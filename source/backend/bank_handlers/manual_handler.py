from contextlib import contextmanager
from datetime import date
from typing import Iterator

from source.backend.bank_handlers.base import (
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)


class _ManualSession(BankSession):
    def get_accounts(self) -> list[FetchedAccount]:
        return []

    def get_balance(self, account: FetchedAccount) -> float:
        # Unreachable in practice as get_accounts() returns []
        logger.warning("get_balance() was called on ManualHandler")
        return 0.0

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        # Unreachable in practice as get_accounts() returns []
        logger.warning("get_transactions() was called on ManualHandler")
        return []


class ManualHandler(BankHandler):
    CREDENTIAL_FIELDS: tuple[str, ...] = ()

    @contextmanager
    def session(self) -> Iterator[_ManualSession]:
        yield _ManualSession()
