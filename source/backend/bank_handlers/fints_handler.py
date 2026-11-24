import time
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextlib import contextmanager
from dataclasses import replace
from datetime import date, timedelta
from time import sleep
from typing import Iterator, TypeVar, cast

import fints_url
import requests
from fints.camt_parser import camt053_to_dict
from fints.client import FinTS3PinTanClient, NeedTANResponse
from fints.exceptions import FinTSClientError, FinTSClientPINError
from fints.formals import Balance1, Balance2, Response
from fints.models import SEPAAccount
from fints.models import Transaction as FinTSTransaction

from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankHandler,
    BankInfo,
    BankSession,
    CancelCheck,
    FetchedAccount,
    FetchedTransaction,
    TwoFactorCodeRequest,
    TwoFactorStateCallback,
)
from source.backend.exceptions import (
    BankRefusedRequestError,
    BankTimedOutError,
    InvalidCredentialsError,
    ReauthenticationRequiredError,
    SyncCancelledError,
    TanNotAcceptedError,
    UnsupportedBankError,
    UnsupportedTanMethodError,
    exception_chain,
)
from source.backend.helpers import get_key_of_transaction
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType

logger = get_logger(__name__)

# python-fints marks the balance booking-date required, but DKB omits it (e.g. for zero-balance Tagesgeld accounts),
# so the whole HISAL segment fails to parse and get_balance raises 'FinTS3Segment' has no 'balance_booked'.
# The date is informational only --> make it optional so the balance still parses.
Balance1._fields["date"].required = False  # pyright: ignore[reportAttributeAccessIssue]  # python-fints internal
Balance2._fields["date"].required = False  # pyright: ignore[reportAttributeAccessIssue]  # python-fints internal

FINTS_CONNECT_TIMEOUT = timedelta(seconds=10)
FINTS_READ_TIMEOUT = timedelta(minutes=2)
APPROVAL_TIMEOUT = timedelta(minutes=3)
APPROVAL_POLL_INTERVAL = timedelta(seconds=2)
PENDING_LOOKBACK = timedelta(days=14)
FETCH_CHUNK_LENGTH = timedelta(days=30)
MAX_TRANSACTION_HISTORY = timedelta(days=4 * 365)
PARTIALLY_EXECUTED_RESPONSE_CODE = "3997"

# Deutsche Bank advertises MT940 (HIKAZS) but only answers transaction requests via CAMT (#158)
DEUTSCHE_BANK_FINTS_URL = "https://fints.deutsche-bank.de"

T = TypeVar("T")


class _TimeoutSession(requests.Session):
    # python-fints posts without any timeout, so a bank that accepts the connection and then goes quiet hangs the sync
    # thread forever
    # Drop this once https://github.com/raphaelm/python-fints/pull/224 is released and pass timeout= instead
    def request(self, *args: object, **kwargs: object) -> requests.Response:
        timeout = (FINTS_CONNECT_TIMEOUT.total_seconds(), FINTS_READ_TIMEOUT.total_seconds())
        kwargs.setdefault("timeout", timeout)  # noqa: FKA100
        return super().request(*args, **kwargs)  # pyright: ignore[reportArgumentType]  # forwarded verbatim


class _FinTSSession(BankSession):
    def __init__(
        self,
        client: FinTS3PinTanClient,
        notify_two_factor_state: TwoFactorStateCallback | None = None,
        is_cancelled: CancelCheck | None = None,
        request_two_factor_code: TwoFactorCodeRequest | None = None,
    ):
        self._client = client
        self._notify_two_factor_state = notify_two_factor_state
        self._is_cancelled = is_cancelled
        self._request_two_factor_code = request_two_factor_code
        self._account_mapping: dict[str, SEPAAccount] = {}
        self._balance_observations: dict[str, list[BalanceObservation]] = {}
        self._mt940_refused = False
        self.system_id: str | None = None

    def get_accounts(self) -> list[FetchedAccount]:
        accounts = self._resolve(self._client.get_sepa_accounts())
        self._account_mapping = {account.iban: account for account in accounts}
        logger.debug(f"FinTS returned {len(accounts)} SEPA account(s)")
        return [FetchedAccount(name=account.iban, external_id=account.iban) for account in accounts]

    def get_balance(self, account: FetchedAccount) -> float:
        balance = self._resolve(self._client.get_balance(self._account_mapping[account.name]))
        return float(balance.amount.amount)  # pyright: ignore[reportOptionalMemberAccess]

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        sepa_account = self._account_mapping[account.name]
        # FinTS merges booked + pending into one unlabelled list, so we ask for booked-only and for booked+pending
        # separately and treat the difference as the pending set. The bank gives no stable transaction id, so this is
        # the only reliable way to label pending transactions.
        pending_start = date.today() - PENDING_LOOKBACK
        booked_start = max(min(start_date, pending_start), date.today() - MAX_TRANSACTION_HISTORY)
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
        chunks_newest_first = []
        for chunk_number, (chunk_start, chunk_end) in enumerate(reversed(_date_ranges(start_date))):
            if self._is_cancelled is not None and self._is_cancelled():
                error_message = "Sync cancelled while fetching transactions; aborting"
                logger.info(error_message)
                raise SyncCancelledError(error_message)
            chunk_transactions, bank_responses = self._fetch_chunk(
                sepa_account, start_date=chunk_start, end_date=chunk_end, include_pending=include_pending
            )
            chunks_newest_first.append(chunk_transactions)
            refusals = [_describe(response) for response in bank_responses if _refuses_older_transactions(response)]
            if not refusals:
                continue
            if chunk_number == 0 and any(_is_error(response) for response in bank_responses):
                # Refusing even the current period isn't the end of the bank's history but a failed request. Reporting
                # it as "no transactions" would let the sync succeed and the next one start after this gap.
                error_message = (
                    f"The bank refused the transactions from {chunk_start} to {chunk_end}: {'; '.join(refusals)}"
                )
                logger.error(error_message)
                raise BankRefusedRequestError(error_message)
            logger.info(
                f"Bank refused the transactions from {chunk_start} to {chunk_end} ({'; '.join(refusals)}); "
                f"not fetching further back"
            )
            break
        raw_transactions = []
        for chunk_transactions in reversed(chunks_newest_first):
            self._balance_observations.setdefault(sepa_account.iban, []).extend(  # noqa: FKA100
                _extract_balance_observations(chunk_transactions)
            )
            raw_transactions += chunk_transactions
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
                    transaction_type=TransactionType.from_amount(amount=amount),
                )
            )
        return transactions

    def _fetch_chunk(
        self, sepa_account: SEPAAccount, start_date: date, end_date: date, include_pending: bool
    ) -> tuple[list, list[Response]]:
        uses_camt = self._uses_camt()
        transactions, bank_responses = self._fetch_chunk_in_format(
            sepa_account, start_date=start_date, end_date=end_date, include_pending=include_pending, camt=uses_camt
        )
        errors = [_describe(response) for response in bank_responses if _is_error(response)]
        supports_camt = self._client.bpd.find_segment_first("HICAZS") is not None
        if not errors or uses_camt or not supports_camt:
            return transactions, bank_responses

        # Some banks advertise MT940 but fail on it while answering the same request in CAMT (#158, #216)
        logger.warning(
            f"Bank refused the MT940 transactions from {start_date} to {end_date} ({'; '.join(errors)}); "
            f"retrying with CAMT"
        )
        transactions, bank_responses = self._fetch_chunk_in_format(
            sepa_account, start_date=start_date, end_date=end_date, include_pending=include_pending, camt=True
        )
        if not any(_is_error(response) for response in bank_responses):
            logger.info("Bank accepted the CAMT request; using CAMT for the rest of this session")
            self._mt940_refused = True
        return transactions, bank_responses

    def _fetch_chunk_in_format(
        self, sepa_account: SEPAAccount, start_date: date, end_date: date, include_pending: bool, camt: bool
    ) -> tuple[list, list[Response]]:
        logger.debug(
            f"Fetching transactions from {start_date} to {end_date} via {'CAMT' if camt else 'MT940'} "
            f"(include_pending={include_pending})"
        )
        with _collect_bank_responses(self._client) as bank_responses:
            raw_transactions = self._resolve(
                self._fetch_raw_transactions(
                    sepa_account, start_date=start_date, end_date=end_date, include_pending=include_pending, camt=camt
                )
            )
        transactions = _parse_camt_if_needed(raw_transactions, include_pending=include_pending)
        logger.debug(
            f"Bank answered with {len(transactions)} transaction(s) and the responses: "
            f"{'; '.join(_describe(response) for response in bank_responses) or 'none'}"
        )
        return transactions, bank_responses

    def _uses_camt(self) -> bool:
        supports_mt940 = self._client.bpd.find_segment_first("HIKAZS") is not None
        is_deutsche_bank = self._client.connection.url.rstrip("/") == DEUTSCHE_BANK_FINTS_URL
        return self._mt940_refused or not supports_mt940 or is_deutsche_bank

    def _fetch_raw_transactions(
        self, sepa_account: SEPAAccount, start_date: date, end_date: date, include_pending: bool, camt: bool
    ) -> list | tuple | NeedTANResponse:
        if camt:
            return self._client.get_transactions_xml(sepa_account, start_date=start_date, end_date=end_date)
        return self._client.get_transactions(
            sepa_account, start_date=start_date, end_date=end_date, include_pending=include_pending
        )

    def _resolve(self, response: T) -> T:
        return _resolve_tan(
            client=self._client,
            response=response,
            notify_two_factor_state=self._notify_two_factor_state,
            is_cancelled=self._is_cancelled,
            request_two_factor_code=self._request_two_factor_code,
        )


def _date_ranges(start_date: date) -> list[tuple[date, date]]:
    today = date.today()
    ranges = []
    chunk_start = start_date
    while chunk_start <= today:
        chunk_end = min(chunk_start + FETCH_CHUNK_LENGTH - timedelta(days=1), today)
        ranges.append((chunk_start, chunk_end))
        chunk_start = chunk_end + timedelta(days=1)
    return ranges


def _parse_camt_if_needed(result: object, include_pending: bool) -> list:
    # python-fints' get_transactions normally returns a ready list of (mt940) Transaction objects.
    # But banks that only offer CAMT XML (e.g., Volksbank) take a special path: when a decoupled
    # TAN interrupts the fetch, get_transactions returns the NeedTANResponse *before* its own CAMT
    # parsing runs. Once we resolve the TAN via send_tan, the bank hands back the raw
    # (booked_streams, pending_streams) tuple of XML bytestrings instead (the library's parsing is
    # never reached). Reproduce that parsing here so both paths yield the same Transaction list.
    if not isinstance(result, tuple):
        # the non-tuple path is always the ready mt940 transaction list
        return cast(list, result)
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
        client = FinTS3PinTanClient(
            bank_identifier=bank_identifier,
            user_id=user_id,
            pin=pin,
            server=server,
            product_id=self.FINTS_PRODUCT_ID,
            system_id=self.credentials.get("system_id"),
        )
        client.connection.session = _TimeoutSession()
        return client

    @contextmanager
    def session(self) -> Iterator[_FinTSSession]:
        bank_identifier = self.bank_info.bank_identifier or self.credentials.get("blz")
        logger.debug(f"Opening FinTS session for bank {bank_identifier}")
        with _as_timed_out_on_unresponsive_bank(bank_identifier=bank_identifier):
            yield from self._session()

    def _session(self) -> Iterator[_FinTSSession]:
        client = self.client(user_id=self.credentials["username"], pin=self.credentials["password"])
        with _as_invalid_credentials_on_login_failure():
            _try_configure_pushtan_mechanism(client)
        with client:
            with _as_invalid_credentials_on_login_failure():
                client.init_tan_response = _resolve_tan(
                    client=client,
                    response=client.init_tan_response,
                    notify_two_factor_state=self.notify_two_factor_state,
                    is_cancelled=self.is_cancelled,
                    request_two_factor_code=self.request_two_factor_code,
                )
            bank_session = _FinTSSession(
                client=client,
                notify_two_factor_state=self.notify_two_factor_state,
                is_cancelled=self.is_cancelled,
                request_two_factor_code=self.request_two_factor_code,
            )
            yield bank_session
            # Persist the system_id after a successful session (it's None if the session failed).
            if client.system_id and client.system_id != "0":
                bank_session.system_id = client.system_id


@contextmanager
def _as_timed_out_on_unresponsive_bank(bank_identifier: str | None) -> Iterator[None]:
    # Wraps the caller's whole `with session()` body, so a stall during any request is caught, not just during login.
    try:
        yield
    except Exception as e:
        # python-fints buries every transport error in a "Authentication data wrong?" dialog error, so the real cause
        # has to be dug out of the chain. Without that a bank that stopped answering looks like a wrong password.
        if not any(isinstance(cause, requests.exceptions.Timeout) for cause in exception_chain(e)):
            raise
        message = f"The FinTS server of bank {bank_identifier} did not respond within {FINTS_READ_TIMEOUT}"
        logger.warning(message)
        raise BankTimedOutError(message) from e


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
        # This can only happen when a bank was removed from the fints catalog after it was added
        error_message = f"No FinTS server known for BLZ {bank_code}: {e}"
        logger.error(error_message)
        raise UnsupportedBankError(error_message) from e
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
        _, media = client.get_tan_media() or (None, [])
        if not media:
            error_message = "Bank requires a TAN medium for pushTAN but none was returned"
            logger.warning(error_message)
            raise ReauthenticationRequiredError(error_message)
        client.set_tan_medium(media[0])


def _resolve_tan(
    client: FinTS3PinTanClient,
    response: T,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
    is_cancelled: CancelCheck | None = None,
    request_two_factor_code: TwoFactorCodeRequest | None = None,
) -> T:
    if not isinstance(response, NeedTANResponse):
        return response
    if response.decoupled:
        return _await_decoupled_approval(
            client=client, response=response, notify_two_factor_state=notify_two_factor_state, is_cancelled=is_cancelled
        )
    response = _send_entered_tan(
        client=client,
        response=response,
        notify_two_factor_state=notify_two_factor_state,
        is_cancelled=is_cancelled,
        request_two_factor_code=request_two_factor_code,
    )
    return _resolve_tan(
        client=client,
        response=response,
        notify_two_factor_state=notify_two_factor_state,
        is_cancelled=is_cancelled,
        request_two_factor_code=request_two_factor_code,
    )


def _send_entered_tan(
    client: FinTS3PinTanClient,
    response: NeedTANResponse,
    notify_two_factor_state: TwoFactorStateCallback | None,
    is_cancelled: CancelCheck | None,
    request_two_factor_code: TwoFactorCodeRequest | None,
) -> object:
    mechanism = client.get_current_tan_mechanism()
    is_unsupported_challenge = response.challenge_matrix is not None or response.challenge_hhduc is not None
    if is_unsupported_challenge:
        error_message = f"TAN mechanism {mechanism} is not supported"
        logger.warning(error_message)
        raise UnsupportedTanMethodError(error_message)
    if request_two_factor_code is None:
        error_message = f"Bank requested a TAN (mechanism {mechanism}), but nobody can enter it in an unattended sync"
        logger.warning(error_message)
        raise ReauthenticationRequiredError(error_message)

    logger.info(f"Waiting for the TAN of mechanism {mechanism} (up to {APPROVAL_TIMEOUT})")
    logger.debug(f"TAN challenge: {response.challenge!r}")
    tan = _wait_for_entered_tan(code=request_two_factor_code(), is_cancelled=is_cancelled)
    client_error: FinTSClientError | None = None
    with _collect_bank_responses(client) as bank_responses:
        try:
            response = client.send_tan(challenge=response, tan=tan)
        except FinTSClientError as e:
            client._standing_dialog.open = False  # pyright: ignore[reportOptionalMemberAccess]
            client_error = e
        finally:
            if notify_two_factor_state is not None:
                notify_two_factor_state(False)
    bank_errors = [_describe(bank_response) for bank_response in bank_responses if _is_error(bank_response)]
    if client_error is not None and not bank_errors:
        bank_errors.append(str(client_error))
    if bank_errors:
        error_message = f"The bank did not accept the TAN: {'; '.join(bank_errors)}"
        logger.warning(error_message)
        raise TanNotAcceptedError(error_message)
    logger.info("TAN accepted")
    return response


@contextmanager
def _collect_bank_responses(client: FinTS3PinTanClient) -> Iterator[list[Response]]:
    bank_responses: list[Response] = []

    def collect(_segment: object, bank_response: Response) -> None:
        bank_responses.append(bank_response)

    client.add_response_callback(collect)
    try:
        yield bank_responses
    finally:
        client.remove_response_callback(collect)


def _is_error(bank_response: Response) -> bool:
    return bank_response.code.startswith("9")


def _refuses_older_transactions(bank_response: Response) -> bool:
    return _is_error(bank_response) or bank_response.code == PARTIALLY_EXECUTED_RESPONSE_CODE


def _describe(bank_response: Response) -> str:
    return f"{bank_response.code} {bank_response.text}"


def _wait_for_entered_tan(code: Future[str], is_cancelled: CancelCheck | None) -> str:
    deadline = time.monotonic() + APPROVAL_TIMEOUT.total_seconds()
    try:
        while True:
            if is_cancelled is not None and is_cancelled():
                logger.info("TAN entry cancelled by user; aborting sync")
                raise SyncCancelledError("Sync cancelled while waiting for the TAN")
            if time.monotonic() > deadline:
                error_message = f"No TAN was entered within {APPROVAL_TIMEOUT}"
                logger.warning(error_message)
                raise TanNotAcceptedError(error_message)
            try:
                return code.result(timeout=APPROVAL_POLL_INTERVAL.total_seconds())
            except FutureTimeoutError:
                continue
    finally:
        code.cancel()


def _await_decoupled_approval(
    client: FinTS3PinTanClient,
    response: T,
    notify_two_factor_state: TwoFactorStateCallback | None = None,
    is_cancelled: CancelCheck | None = None,
) -> T:
    if notify_two_factor_state is not None:
        notify_two_factor_state(True)
    try:
        deadline = time.monotonic() + APPROVAL_TIMEOUT.total_seconds()
        started = time.monotonic()
        attempts = 0
        logger.info(f"Waiting for pushTAN app approval (up to {APPROVAL_TIMEOUT})")
        while isinstance(response, NeedTANResponse):
            if is_cancelled is not None and is_cancelled():
                logger.info("pushTAN wait cancelled by user; aborting sync")
                raise SyncCancelledError("Sync cancelled while waiting for pushTAN approval")
            if time.monotonic() > deadline:
                error_message = f"pushTAN approval did not arrive within {APPROVAL_TIMEOUT}"
                logger.warning(error_message)
                raise ReauthenticationRequiredError(error_message)
            sleep(APPROVAL_POLL_INTERVAL.total_seconds())
            attempts += 1
            response = client.send_tan(response, tan="")
            logger.debug(
                f"pushTAN poll attempt {attempts} ({time.monotonic() - started:.1f}s elapsed): "
                f"response is {type(response).__name__}"
            )
        logger.info("pushTAN approval received")
        return response
    finally:
        if notify_two_factor_state is not None:
            notify_two_factor_state(False)
