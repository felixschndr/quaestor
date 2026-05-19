from contextlib import contextmanager
from datetime import date
from typing import Iterator

from fints.client import FinTS3PinTanClient
from fints.models import SEPAAccount
from source.backend.bank_handlers.base import (
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
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

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        sepa_account = self._account_mapping[account.name]
        raw_transactions = self._client.get_transactions(sepa_account, start_date=start_date, include_pending=True)
        transactions = []
        for raw_transaction in raw_transactions:
            data = raw_transaction.data
            amount = data["amount"]
            transactions.append(
                FetchedTransaction(
                    amount=float(amount.amount),
                    purpose=data.get("purpose"),
                    date=data["date"],
                    recipient=data.get("applicant_name"),
                )
            )
        logger.debug(f"FinTS returned {len(transactions)} transaction(s) for {account.name} since {start_date}")
        return transactions


class FinTSHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password")

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
        client = self.client(user_id=self.credentials["username"], pin=self.credentials["password"])
        with client:
            yield _FinTSSession(client)
