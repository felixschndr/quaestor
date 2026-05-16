from contextlib import contextmanager
from typing import Iterator

from fints.client import FinTS3PinTanClient
from fints.models import SEPAAccount
from source.bank_handlers.base import BankHandler, BankSession, FetchedAccount


class _FinTSSession(BankSession):
    def __init__(self, client: FinTS3PinTanClient):
        super().__init__()

        self._client = client

        self._account_mapping: dict[str, SEPAAccount]

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = self._client.get_sepa_accounts()
        self._account_mapping = {account.iban: account for account in accounts}
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
        client = self.client(self.username, self.password)
        with client:
            yield _FinTSSession(client)
