import time
from contextlib import contextmanager
from dataclasses import replace
from datetime import date, timedelta
from time import sleep
from typing import Iterator, TypeVar

import fints_url
from fints.camt_parser import camt053_to_dict
from fints.client import FinTS3PinTanClient, NeedTANResponse
from fints.exceptions import FinTSClientPINError
from fints.models import SEPAAccount
from fints.models import Transaction as FinTSTransaction

from source.backend.bank_handlers.base import (
    BalanceObservation,
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
from source.backend.helpers import get_key_of_transaction
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType

logger = get_logger(__name__)

APPROVAL_TIMEOUT = timedelta(minutes=3)
APPROVAL_POLL_INTERVAL = timedelta(seconds=2)
PENDING_LOOKBACK = timedelta(days=14)

T = TypeVar("T")


class _FinTSSession(BankSession):
    def __init__(self, client: FinTS3PinTanClient, notify_two_factor_state: TwoFactorStateCallback | None = None):
        self._client = client
        self._notify_two_factor_state = notify_two_factor_state

        self._account_mapping: dict[str, SEPAAccount] = {}
        self._balance_observations: dict[str, list[BalanceObservation]] = {}

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = self._resolve(self._client.get_sepa_accounts())
        self._account_mapping = {account.iban: account for account in accounts}
        logger.debug(f"FinTS returned {len(accounts)} SEPA account(s)")
        return [FetchedAccount(name=account.iban, external_id=account.iban) for account in accounts]

    def get_balance(self, account: FetchedAccount) -> float:
        balance = self._resolve(self._client.get_balance(self._account_mapping[account.name]))
        return float(balance.amount.amount)

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        sepa_account = self._account_mapping[account.name]
        # FinTS merges booked + pending into one unlabelled list, so we ask for booked-only and for booked+pending
        # separately and treat the difference as the pending set. The bank gives no stable transaction id, so this is
        # the only reliable way to label pending transactions.
        pending_start = date.today() - PENDING_LOOKBACK
        booked_start = min(start_date, pending_start)
        # Each fetch is over a different window, so each yields its own opening-balance anchor (the
        # booked one reaches further back, the pending one anchors ~2 weeks ago). Collect both.
        self._balance_observations[sepa_account.iban] = []
        booked_transactions = self._fetch_transactions(sepa_account, start_date=booked_start, include_pending=False)
        booked_and_pending_transactions = self._fetch_transactions(
            sepa_account, start_date=pending_start, include_pending=True
        )

        booked_keys = {get_key_of_transaction(transaction) for transaction in booked_transactions}
        transactions = list(booked_transactions)
        for transaction in booked_and_pending_transactions:
            if get_key_of_transaction(transaction) not in booked_keys:
                transactions.append(replace(transaction, pending=True))

        logger.debug(
            f"FinTS returned {len(transactions)} transaction(s) for {account.name} since {start_date} "
            f"({sum(1 for transaction in transactions if transaction.pending)} pending)"
        )
        return transactions

    def get_balance_observations(self, account: FetchedAccount) -> list[BalanceObservation]:
        sepa_account = self._account_mapping.get(account.name)
        if sepa_account is None:
            return []
        return self._balance_observations.get(sepa_account.iban, [])  # noqa: FKA100

    def _fetch_transactions(
        self, sepa_account: SEPAAccount, start_date: date, include_pending: bool
    ) -> list[FetchedTransaction]:
        raw_transactions = _parse_camt_if_needed(
            self._resolve(
                self._fetch_raw_transactions(sepa_account, start_date=start_date, include_pending=include_pending)
            ),
            include_pending=include_pending,
        )
        self._balance_observations.setdefault(sepa_account.iban, []).extend(  # noqa: FKA100
            _extract_balance_observations(raw_transactions)
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
        return transactions

    def _fetch_raw_transactions(
        self, sepa_account: SEPAAccount, start_date: date, include_pending: bool
    ) -> list | tuple | NeedTANResponse:
        if self._client.bpd.find_segment_first("HIKAZS") is not None:
            return self._client.get_transactions(sepa_account, start_date=start_date, include_pending=include_pending)
        return self._client.get_transactions_xml(sepa_account, start_date=start_date)

    def _resolve(self, response: T) -> T:
        return _resolve_decoupled(
            client=self._client, response=response, notify_two_factor_state=self._notify_two_factor_state
        )


def _parse_camt_if_needed(result: object, include_pending: bool) -> list:
    # python-fints' get_transactions normally returns a ready list of (mt940) Transaction objects.
    # But banks that only offer CAMT XML (e.g., Volksbank) take a special path: when a decoupled
    # TAN interrupts the fetch, get_transactions returns the NeedTANResponse *before* its own CAMT
    # parsing runs. Once we resolve the TAN via send_tan, the bank hands back the raw
    # (booked_streams, pending_streams) tuple of XML bytestrings instead (the library's parsing is
    # never reached). Reproduce that parsing here so both paths yield the same Transaction list.
    if not isinstance(result, tuple):
        return result
    booked_streams, pending_streams = result
    transactions = [FinTSTransaction(data) for stream in booked_streams for data in camt053_to_dict(stream)]
    if include_pending:
        transactions += [
            FinTSTransaction(data) for stream in pending_streams if stream for data in camt053_to_dict(stream)
        ]
    return transactions


def _extract_balance_observations(raw_transactions: list) -> list[BalanceObservation]:
    # python-fints returns a list of mt940 Transaction objects; each holds a back-reference to its
    # statement collection, whose .data carries the statement-level balances. When the period had no
    # transactions the list is empty and the bank gives us no anchor.
    #
    # We only take the *opening* balance: it's a real historical anchor. The closing balance is dated
    # the last booking day and -- since nothing is booked after it -- always equals the current balance
    # we already start the backward walk from, so it adds no information and would only risk spurious
    # drift warnings when it disagrees with the HKSAL balance.
    if not raw_transactions:
        return []
    try:
        balance = raw_transactions[0].transactions.data.get("final_opening_balance")  # noqa: FKA100
    except AttributeError:
        # CAMT-only banks (e.g., Volksbank) yield camt Transaction objects without a statement back-reference
        return []
    if balance is None or balance.date is None or balance.amount is None:
        return []
    observation_date = date(year=balance.date.year, month=balance.date.month, day=balance.date.day)
    return [BalanceObservation(date=observation_date, amount=float(balance.amount.amount))]


def _transaction_type_from_amount(amount: float) -> TransactionType:
    if amount > 0:
        return TransactionType.INCOMING
    if amount < 0:
        return TransactionType.OUTGOING
    return TransactionType.ZERO


class FinTSHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password")
    # Only relevant for banks without a pinned BLZ (e.g. Sparkasse), where the user enters
    # it themselves — often in spaced groups like "660 501 01".
    WHITESPACE_STRIPPED_FIELDS = frozenset({"blz"})

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
