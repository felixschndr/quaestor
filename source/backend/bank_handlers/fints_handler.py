from contextlib import contextmanager
from typing import Iterator

from fints.client import FinTS3PinTanClient
from fints.models import SEPAAccount
from source.backend.bank_handlers.base import BankHandler, BankSession, FetchedAccount
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)


class _FinTSSession(BankSession):
    def __init__(self, client: FinTS3PinTanClient):
        super().__init__()

        self._client = client

        self._account_mapping: dict[str, SEPAAccount]

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = self._client.get_sepa_accounts()
        self._account_mapping = {account.iban: account for account in accounts}
        logger.debug(f"FinTS returned {len(accounts)} SEPA account(s)")
        return [FetchedAccount(name=account.iban) for account in accounts]

    def get_balance(self, account: FetchedAccount) -> float:
        balance = self._client.get_balance(self._account_mapping[account.name])
        return float(balance.amount.amount)


class FinTSHandler(BankHandler):
    PRODUCT_ID_SECRET_NAME = "fints_product_id"  # nosec B105
    product_id: str = ""  # set by the service layer from the application secret before syncing

    def client(self, user_id: str, pin: str) -> FinTS3PinTanClient:
        return FinTS3PinTanClient(
            bank_identifier=self.bank_info.bank_identifier,
            user_id=user_id,
            pin=pin,
            server=self.bank_info.fints_url,
            product_id=self.product_id,
        )

    @contextmanager
    def session(self) -> Iterator[_FinTSSession]:
        logger.debug(f"Opening FinTS session for bank {self.bank_info.bank_identifier}")
        client = self.client(user_id=self.username, pin=self.password)
        with client:
            yield _FinTSSession(client)
