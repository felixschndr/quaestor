import time
from contextlib import contextmanager
from datetime import date, timedelta
from time import sleep
from typing import Iterator, TypeVar

import fints_url
from fints.client import FinTS3PinTanClient, NeedTANResponse
from fints.exceptions import FinTSClientPINError
from fints.models import SEPAAccount
from source.backend.bank_handlers.base import (
    BankHandler,
    BankInfo,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
    TwoFactorStateCallback,
)
from source.backend.exceptions import (
    InvalidCredentialsError,
    ReauthenticationRequiredError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.transaction_type import TransactionType

logger = get_logger(__name__)

APPROVAL_TIMEOUT = timedelta(minutes=3)
APPROVAL_POLL_INTERVAL = timedelta(seconds=2)

T = TypeVar("T")


class _FinTSSession(BankSession):
    def __init__(self, client: FinTS3PinTanClient, notify_two_factor_state: TwoFactorStateCallback | None = None):
        super().__init__()

        self._client = client
        self._notify_two_factor_state = notify_two_factor_state

        self._account_mapping: dict[str, SEPAAccount]

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = self._resolve(self._client.get_sepa_accounts())
        self._account_mapping = {account.iban: account for account in accounts}
        logger.debug(f"FinTS returned {len(accounts)} SEPA account(s)")
        return [FetchedAccount(name=account.iban) for account in accounts]

    def get_balance(self, account: FetchedAccount) -> float:
        balance = self._resolve(self._client.get_balance(self._account_mapping[account.name]))
        return float(balance.amount.amount)

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        sepa_account = self._account_mapping[account.name]
        raw_transactions = self._resolve(
            self._client.get_transactions(sepa_account, start_date=start_date, include_pending=True)
        )
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

    def _resolve(self, response: T) -> T:
        return _resolve_decoupled(
            client=self._client, response=response, notify_two_factor_state=self._notify_two_factor_state
        )


def _transaction_type_from_amount(amount: float) -> TransactionType:
    if amount > 0:
        return TransactionType.INCOMING
    if amount < 0:
        return TransactionType.OUTGOING
    return TransactionType.UNKNOWN


class FinTSHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password")

    # Generic/public product ID from the python-fints GitHub repo.
    FINTS_PRODUCT_ID = "6151256F3D4F9975B877BD4A2"

    @classmethod
    def credential_fields(cls: type["FinTSHandler"], bank_info: BankInfo) -> tuple[str, ...]:
        # If the BankInfo doesn't pin a BLZ (e.g., Sparkasse, where every regional bank
        # has its own bank code), require the user to supply it.
        extras: tuple[str, ...] = ("blz",) if bank_info.bank_identifier is None else ()
        return cls.CREDENTIAL_FIELDS + extras

    def client(self, user_id: str, pin: str) -> FinTS3PinTanClient:
        bank_identifier = self.bank_info.bank_identifier or self.credentials["blz"]
        server = self.bank_info.fints_url or _resolve_fints_url(bank_identifier)
        return FinTS3PinTanClient(
            bank_identifier=bank_identifier,
            user_id=user_id,
            pin=pin,
            server=server,
            product_id=self.FINTS_PRODUCT_ID,
        )

    @contextmanager
    def session(self) -> Iterator[_FinTSSession]:
        bank_identifier = self.bank_info.bank_identifier or self.credentials.get("blz")
        logger.debug(f"Opening FinTS session for bank {bank_identifier}")
        client = self.client(user_id=self.credentials["username"], pin=self.credentials["password"])
        with _as_invalid_credentials_on_login_failure():
            _try_configure_pushtan_mechanism(client)
        with client:
            with _as_invalid_credentials_on_login_failure():
                client.init_tan_response = _resolve_decoupled(
                    client=client,
                    response=client.init_tan_response,
                    notify_two_factor_state=self.notify_two_factor_state,
                )
            yield _FinTSSession(client=client, notify_two_factor_state=self.notify_two_factor_state)


@contextmanager
def _as_invalid_credentials_on_login_failure() -> Iterator[None]:
    # Map the bank's "login rejected" signals to a clear domain error
    try:
        yield
    except FinTSClientPINError as e:
        message = f"The bank rejected the login: {e}"
        logger.warning(message)
        raise InvalidCredentialsError(message) from e
    except ValueError as e:
        if "system_id" not in str(e):
            raise
        message = "The bank rejected the login; the username or password is likely incorrect"
        logger.warning(message)
        raise InvalidCredentialsError(message) from e


def _resolve_fints_url(bank_code: str) -> str:
    try:
        url = fints_url.find(bank_code=bank_code)
    except Exception as e:
        error_message = f"No FinTS server known for BLZ {bank_code}: {e}"
        logger.warning(error_message)
        raise InvalidCredentialsError(error_message) from e
    logger.debug(f"Resolved FinTS URL for BLZ {bank_code}: {url}")
    return url


def _try_configure_pushtan_mechanism(client: FinTS3PinTanClient) -> None:
    # Select the pushTAN mechanism if the bank advertises one. Otherwise no-op:
    # many banks don't require a TAN for read-only operations.
    client.fetch_tan_mechanisms()
    mechanisms = client.get_tan_mechanisms()
    push_entry = next(
        ((sec_func, mech) for sec_func, mech in mechanisms.items() if "push" in mech.name.lower()),
        None,
    )
    if push_entry is None:
        advertised = ", ".join(f"{sec_func}={mech.name}" for sec_func, mech in mechanisms.items()) or "none"
        logger.debug(f"No pushTAN mechanism advertised (available: {advertised}); skipping setup")
        return

    sec_func, mechanism = push_entry
    logger.debug(f"Selecting TAN mechanism {sec_func}: {mechanism.name}")
    client.set_tan_mechanism(sec_func)
    description_required = getattr(mechanism, "description_required", None)
    if description_required is not None and str(description_required) == "MUST":
        media = list(client.get_tan_media())
        if not media:
            error_message = "Bank requires a TAN medium for pushTAN but none was returned"
            logger.warning(error_message)
            raise ReauthenticationRequiredError(error_message)
        client.set_tan_medium(media[0])


def _resolve_decoupled(
    client: FinTS3PinTanClient,
    response: T,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
) -> T:
    # Resolve a (possibly pending) NeedTANResponse by polling the bank's pushTAN app.
    # Returns the resolved (non-NeedTANResponse) value, or the input unchanged when no
    # TAN was needed. Notifies the caller via the callback when the wait starts/ends so
    # the UI can show "please confirm in app".
    if not isinstance(response, NeedTANResponse):
        return response
    if not response.decoupled:
        error_message = "Bank requested a non-decoupled TAN; only pushTAN app approval is supported"
        logger.warning(error_message)
        raise ReauthenticationRequiredError(error_message)

    if notify_two_factor_state is not None:
        notify_two_factor_state(True)
    try:
        deadline = time.monotonic() + APPROVAL_TIMEOUT.total_seconds()
        logger.info(f"Waiting for pushTAN app approval (up to {APPROVAL_TIMEOUT})")
        while isinstance(response, NeedTANResponse):
            if time.monotonic() > deadline:
                error_message = f"pushTAN approval did not arrive within {APPROVAL_TIMEOUT}"
                logger.warning(error_message)
                raise ReauthenticationRequiredError(error_message)
            sleep(APPROVAL_POLL_INTERVAL.total_seconds())
            response = client.send_tan(response, tan="")
        logger.info("pushTAN approval received")
        return response
    finally:
        if notify_two_factor_state is not None:
            notify_two_factor_state(False)
