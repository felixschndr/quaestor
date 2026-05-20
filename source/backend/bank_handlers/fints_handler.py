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
from source.backend.models.transaction_type import TransactionType

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
            amount = float(data["amount"].amount)
            transactions.append(
                FetchedTransaction(
                    amount=amount,
                    purpose=data.get("purpose"),
                    date=data["date"],
                    other_party=data.get("applicant_name"),
                    transaction_type=_transaction_type_from_amount(amount=amount),
                )
            )
        logger.debug(f"FinTS returned {len(transactions)} transaction(s) for {account.name} since {start_date}")
        return transactions


def _transaction_type_from_amount(amount: float) -> TransactionType:
    if amount > 0:
        return TransactionType.INCOMING
    if amount < 0:
        return TransactionType.OUTGOING
    return TransactionType.UNKNOWN


class FinTSHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password")

    # This is a generic/public product ID I found in the FinTS GitHub repo
    FINTS_PRODUCT_ID = "6151256F3D4F9975B877BD4A2"

    def client(self, user_id: str, pin: str) -> FinTS3PinTanClient:
        return FinTS3PinTanClient(
            bank_identifier=self.bank_info.bank_identifier,
            user_id=user_id,
            pin=pin,
            server=self.bank_info.fints_url,
            product_id=self.FINTS_PRODUCT_ID,
        )

    @contextmanager
    def session(self) -> Iterator[_FinTSSession]:
        logger.debug(f"Opening FinTS session for bank {self.bank_info.bank_identifier}")
        client = self.client(user_id=self.credentials["username"], pin=self.credentials["password"])
        with client:
            yield _FinTSSession(client)
