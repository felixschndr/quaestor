from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

from fints.client import FinTS3PinTanClient
from fints.models import SEPAAccount
from source.bank_handlers.base import (
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)


class _FinTSSession(BankSession):
    """One open FinTS dialog, reused for accounts, balances and transactions.

    The raw ``SEPAAccount`` namedtuples returned by ``get_sepa_accounts()`` are
    cached on the session so that balance/transaction lookups resolve them by
    IBAN instead of re-fetching the account list.
    """

    def __init__(self, client: FinTS3PinTanClient):
        self._client = client
        self._iban_to_sepa_account_mapping: dict[str, SEPAAccount] = {}

    def _resolve_account_to_sepa_account(self, account: FetchedAccount) -> SEPAAccount:
        if not self._iban_to_sepa_account_mapping:
            self.get_accounts()
        return self._iban_to_sepa_account_mapping[account.external_id]

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = self._client.get_sepa_accounts()
        self._iban_to_sepa_account_mapping = {account.iban: account for account in accounts}
        return [FetchedAccount(external_id=account.iban, name=account.accountnumber) for account in accounts]

    def get_balance(self, account: FetchedAccount) -> float:
        balance = self._client.get_balance(self._resolve_account_to_sepa_account(account))
        return float(balance.amount.amount)

    def get_transactions(self, account: FetchedAccount, since: datetime | None) -> list[FetchedTransaction]:
        raise NotImplementedError


class FinTSHandler(BankHandler):
    def client(self, user_id: str, pin: str) -> FinTS3PinTanClient:
        return FinTS3PinTanClient(
            bank_identifier=self.bank_info.bank_identifier,
            user_id=user_id,
            pin=pin,
            server=self.bank_info.fints_url,
            product_id="XXX",  # TODO: Load application secret
        )

    @contextmanager
    def session(self) -> Iterator[_FinTSSession]:
        client = self.client(self.username, self.password)
        with client:
            yield _FinTSSession(client)
