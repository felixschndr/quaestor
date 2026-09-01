import asyncio
import json
import shutil
import tempfile
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterator, TypedDict

from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
    TwoFactorChallenge,
    build_daily_market_value_history,
)
from source.backend.exceptions import ReauthenticationRequiredError
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.paths import SCALABLE_CLI_BIN
from source.backend.services.banking import scalable_capital_login

logger = get_logger(__name__)

# `sc` error codes that only a fresh device-code login can fix
_REAUTHENTICATION_ERROR_CODES = frozenset({"no_session", "refresh_relogin_required", "auth_grant_not_enabled"})
_RATE_LIMITED_ERROR_CODE = "rate_limited"

# Retry delays for Scalable's backend rate limit (a full sync fires many `sc` calls back to back).
_RATE_LIMIT_BACKOFF_SECONDS = (2, 4, 8, 16)

_TRANSACTION_PAGE_SIZE = "100"
_SETTLED_STATUS = "SETTLED"
_MAX_TRANSACTION_PAGES = 500  # safety net in case the CLI keeps handing back a fresh cursor

_CASH_ACCOUNT_NAME = "Scalable Capital Verrechnungskonto"
_OVERNIGHT_ACCOUNT_NAME = "Scalable Capital Tagesgeld"
_OVERNIGHT_EXTERNAL_ID = "scalable-overnight"

# `summary_type` values (broker_projections.rs' `__typename`) that carry a security `isin` and are
# priced by number of shares, rather than being plain cash movements.
_SIDE_BASED_SUMMARY_TYPES = frozenset({"BrokerSecurityTransactionSummary", "BrokerEltifTransactionSummary"})
_NON_TRADE_SECURITY_SUMMARY_TYPE = "BrokerNonTradeSecurityTransactionSummary"
_ISIN_SUMMARY_TYPES = _SIDE_BASED_SUMMARY_TYPES | {_NON_TRADE_SECURITY_SUMMARY_TYPE}

# `side` on BrokerSecurityTransactionSummary/BrokerEltifTransactionSummary items
_SIDE_TYPE_MAP: dict[str, TransactionType] = {"BUY": TransactionType.BUY, "SELL": TransactionType.SELL}
# `non_trade_security_transaction_type` on BrokerNonTradeSecurityTransactionSummary items
_NON_TRADE_TYPE_MAP: dict[str, TransactionType] = {
    "TRANSFER_IN": TransactionType.TRANSFER_IN,
    "TRANSFER_OUT": TransactionType.TRANSFER_OUT,
}
# `cash_transaction_type` on BrokerCashTransactionSummary items and on overnight transaction items
_CASH_TRANSACTION_TYPE_MAP: dict[str, TransactionType] = {
    "DEPOSIT": TransactionType.DEPOSIT,
    "POCKET_MONEY": TransactionType.DEPOSIT,
    "REINVESTMENT_POCKET_MONEY": TransactionType.DEPOSIT,
    "WITHDRAWAL": TransactionType.REMOVAL,
    "DISTRIBUTION": TransactionType.DIVIDEND,
    "REINVESTMENT_DISTRIBUTION": TransactionType.DIVIDEND,
    "FEE": TransactionType.FEES,
    "INTEREST": TransactionType.INTEREST,
    "TAX": TransactionType.TAXES,
    "TAX_RETURN": TransactionType.TAX_REFUND,
    "SWAP_IN": TransactionType.SWAP,
    "SWAP_OUT": TransactionType.SWAP,
    "CASH_TRANSFER_IN": TransactionType.TRANSFER_IN,
    "CASH_TRANSFER_OUT": TransactionType.TRANSFER_OUT,
    "CURRENCY_SWITCH_BUY": TransactionType.BUY,
    "CURRENCY_SWITCH_SELL": TransactionType.SELL,
}

# Only these change the number of shares held; everything else leaves the position untouched.
_SHARE_MOVE_SIGN: dict[TransactionType, float] = {
    TransactionType.BUY: 1.0,
    TransactionType.SELL: -1.0,
    TransactionType.TRANSFER_IN: 1.0,
    TransactionType.TRANSFER_OUT: -1.0,
}


def ensure_cli_binary_available() -> None:
    if not SCALABLE_CLI_BIN.exists():
        raise RuntimeError(
            f"The `sc` CLI binary is missing at {SCALABLE_CLI_BIN}. " f"See docs/bank_handlers/scalable_capital.md."
        )


async def _run_command(config_dir: Path, args: tuple[str, ...]) -> dict:
    command = [str(SCALABLE_CLI_BIN), *args, "--json"]
    command_text = " ".join(command)
    retries = 0  # one initial attempt plus one retry per configured backoff delay
    while True:
        process = await asyncio.create_subprocess_exec(
            *command,
            env=scalable_capital_login.subprocess_env(config_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()

        # `sc` writes its `{"ok": ...}` envelope to stdout even on failure
        try:
            payload = json.loads(stdout)
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict) and payload.get("ok"):
            data = payload["data"]
            # `sc` nests each broker/overnight command's projection under an extra
            # `result` key alongside resolution metadata (account_id/portfolio_id/resolution for
            # broker.*, account/savings_account_id/selection for overnight.*); `broker chart` does not.
            if isinstance(data, dict) and "result" in data:
                data = data["result"]
            return data

        error = payload.get("error") if isinstance(payload, dict) else None
        error_code = error.get("code") if isinstance(error, dict) else None
        if error_code in _REAUTHENTICATION_ERROR_CODES:
            raise ReauthenticationRequiredError(
                f"`{command_text}` was rejected ({error_code}); re-authentication required."
            )
        if error_code == _RATE_LIMITED_ERROR_CODE and retries < len(_RATE_LIMIT_BACKOFF_SECONDS):
            delay = _RATE_LIMIT_BACKOFF_SECONDS[retries]
            retries += 1
            logger.warning(f"Rate-limited `{command_text}`; retrying in {delay}s")
            await asyncio.sleep(delay)
            continue

        details = stdout.decode(errors="replace").strip() or stderr.decode(errors="replace").strip()
        raise RuntimeError(f"`{command_text}` failed (exit code {process.returncode}): {details}")


def _event_date(raw: dict) -> date:
    return datetime.fromisoformat(raw["last_event_datetime"].replace("Z", "+00:00")).astimezone(timezone.utc).date()


def _get_or_zero(raw: dict, key: str) -> float:
    return float(raw.get(key) or 0)  # noqa FKA100


def _quantity(raw: dict) -> float | None:
    # ELTIF summaries carry `eltif_quantity` instead of `quantity` (broker_projections.rs).
    quantity = raw.get("quantity")
    if quantity is None:
        quantity = raw.get("eltif_quantity")
    return None if quantity is None else float(quantity)


def _transaction_type(raw: dict) -> TransactionType:
    summary_type = raw.get("summary_type")
    if summary_type in _SIDE_BASED_SUMMARY_TYPES:
        transaction_type = _SIDE_TYPE_MAP.get(raw.get("side") or "")
    elif summary_type == _NON_TRADE_SECURITY_SUMMARY_TYPE:
        transaction_type = _NON_TRADE_TYPE_MAP.get(raw.get("non_trade_security_transaction_type") or "")
    else:
        # BrokerCashTransactionSummary, and overnight transaction items, which carry no `summary_type`.
        transaction_type = _CASH_TRANSACTION_TYPE_MAP.get(raw.get("cash_transaction_type") or "")
    return (
        transaction_type
        if transaction_type is not None
        else TransactionType.from_amount(amount=_get_or_zero(raw=raw, key="amount"))
    )


def _isin(raw: dict) -> str | None:
    # Security summaries carry `isin`; cash summaries only reference one via `related_isin`.
    if raw.get("summary_type") in _ISIN_SUMMARY_TYPES:
        return raw.get("isin")
    return raw.get("related_isin")


def _to_fetched_transaction(raw: dict, transaction_type: TransactionType) -> FetchedTransaction:
    return FetchedTransaction(
        amount=_get_or_zero(raw=raw, key="amount"),
        purpose=raw.get("description") or None,
        date=_event_date(raw),
        other_party=None,  # the Scalable Capital API does not expose a counterparty field
        transaction_type=transaction_type,
        bank_reference=raw.get("id"),
    )


class _AccountState(TypedDict):
    balance: float
    transactions: list[FetchedTransaction]
    isin: str | None
    external_id: str


class _ScalableCapitalSession(BankSession):
    def __init__(self, config_dir: Path):
        self._config_dir = config_dir
        self._accounts: dict[str, _AccountState] = {}
        self._has_overnight_account = False
        self._fetched = False
        self._transactions_loaded = False
        self._raw_broker_transactions: list[dict] | None = None
        self._value_history: dict[str, list[BalanceObservation]] | None = None

    def _add_account(self, name: str, external_id: str, balance: float, isin: str | None = None) -> None:
        self._accounts[name] = {
            "balance": round(number=balance, ndigits=2),
            "transactions": [],
            "isin": isin,
            "external_id": external_id,
        }

    def _account_name_for_isin(self, isin: str) -> str | None:
        return next((name for name, state in self._accounts.items() if state["isin"] == isin), None)

    def get_accounts(self) -> list[FetchedAccount]:
        if not self._fetched:
            asyncio.run(self._fetch())
            self._fetched = True
        return [FetchedAccount(name=name, external_id=state["external_id"]) for name, state in self._accounts.items()]

    def get_balance(self, account: FetchedAccount) -> float:
        return self._accounts[account.name]["balance"]

    def get_balance_observations(self, account: FetchedAccount) -> list[BalanceObservation]:
        return [BalanceObservation(date=date.today(), amount=self._accounts[account.name]["balance"])]

    def get_market_value_history(self, account: FetchedAccount) -> list[BalanceObservation]:
        state = self._accounts[account.name]
        if state["isin"] is None:  # cash/overnight accounts are transaction-driven
            return []
        if self._value_history is None:
            self._value_history = asyncio.run(self._fetch_value_history())
        return self._value_history.get(account.name) or []

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        if not self._transactions_loaded:
            asyncio.run(self._fetch_transactions(start_date))
            self._transactions_loaded = True
        transactions = self._accounts[account.name]["transactions"]
        logger.debug(f"Fetched {len(transactions)} transaction(s) for {account.name}")
        return transactions

    async def _fetch(self) -> None:
        cash = await _run_command(config_dir=self._config_dir, args=("broker", "cash-breakdown"))
        account_id = cash.get("account_id") or "scalable_capital"
        self._add_account(
            name=_CASH_ACCOUNT_NAME,
            external_id=f"scalable-cash-{account_id}",
            balance=_get_or_zero(raw=cash, key="cash_balance"),
        )

        holdings = await _run_command(config_dir=self._config_dir, args=("broker", "holdings"))
        for item in holdings.get("items") or []:
            self._add_account(
                name=item["name"],
                external_id=item["isin"],
                balance=_get_or_zero(raw=item, key="valuation"),
                isin=item["isin"],
            )

        try:
            overnight = await _run_command(config_dir=self._config_dir, args=("overnight",))
        except RuntimeError:
            # Not every account has an overnight/Tagesgeld savings product
            logger.debug("No overnight/Tagesgeld account available, skipping")
        else:
            self._has_overnight_account = True
            self._add_account(
                name=_OVERNIGHT_ACCOUNT_NAME,
                external_id=_OVERNIGHT_EXTERNAL_ID,
                balance=_get_or_zero(raw=overnight, key="balance"),
            )

        logger.debug(f"Fetched {len(self._accounts)} account(s)")

    async def _fetch_transactions(self, start_date: date) -> None:
        from_time = f"{start_date.isoformat()}T00:00:00Z"
        for raw in await self._load_broker_transactions():
            if _event_date(raw) >= start_date:
                self._apply_broker_transaction(raw)

        if not self._has_overnight_account:
            return
        try:
            overnight_items = await self._paginated_items(args=("overnight", "transactions", "--from-time", from_time))
        except RuntimeError:
            logger.debug("Overnight/Tagesgeld transactions unavailable, skipping")
        else:
            for raw in overnight_items:
                self._apply_overnight_transaction(raw)

    async def _load_broker_transactions(self) -> list[dict]:
        if self._raw_broker_transactions is None:
            self._raw_broker_transactions = await self._paginated_items(
                args=("broker", "transactions", "--status", _SETTLED_STATUS)
            )
        return self._raw_broker_transactions

    async def _paginated_items(self, args: tuple[str, ...]) -> list[dict]:
        items: list[dict] = []
        cursor: str | None = None
        for _ in range(_MAX_TRANSACTION_PAGES):
            paging_args = ("--page-size", _TRANSACTION_PAGE_SIZE) + (("--cursor", cursor) if cursor else ())
            result = await _run_command(config_dir=self._config_dir, args=args + paging_args)
            page_items = result.get("items") or []
            items.extend(page_items)
            next_cursor = result.get("cursor")
            if not next_cursor or not page_items or next_cursor == cursor:
                break
            cursor = next_cursor
        return items

    def _apply_broker_transaction(self, raw: dict) -> None:
        transaction = _to_fetched_transaction(raw=raw, transaction_type=_transaction_type(raw))
        self._accounts[_CASH_ACCOUNT_NAME]["transactions"].append(transaction)

        isin = _isin(raw)
        if isin:
            position_name = self._account_name_for_isin(isin)
            if position_name is not None:
                self._accounts[position_name]["transactions"].append(transaction)

    def _apply_overnight_transaction(self, raw: dict) -> None:
        if raw.get("status") != _SETTLED_STATUS:  # `overnight transactions` has no --status filter
            return
        self._accounts[_OVERNIGHT_ACCOUNT_NAME]["transactions"].append(
            _to_fetched_transaction(raw=raw, transaction_type=_transaction_type(raw))
        )

    async def _fetch_value_history(self) -> dict[str, list[BalanceObservation]]:
        # The walrus narrows the optional ISIN to a plain str so the downstream lookups stay well-typed.
        positions = {name: isin for name, state in self._accounts.items() if (isin := state["isin"]) is not None}
        if not positions:
            return {}

        share_moves = _share_moves_by_isin(await self._load_broker_transactions())
        history: dict[str, list[BalanceObservation]] = {}
        for name, isin in positions.items():
            prices = await self._price_history(isin)
            observations = build_daily_market_value_history(
                moves=share_moves.get(isin) or [], prices=list(prices.items())
            )
            logger.debug(f"Valued {name} ({isin}): {len(observations)} daily snapshot(s)")
            if observations:
                history[name] = observations
        return history

    async def _price_history(self, isin: str) -> dict[date, float]:
        try:
            chart = await _run_command(
                config_dir=self._config_dir, args=("broker", "chart", "--isin", isin, "--timeframe", "max")
            )
        except RuntimeError:
            logger.debug(f"No chart data for {isin}; skipping its value history")
            return {}
        prices: dict[date, float] = {}
        for point in chart.get("data_points") or []:
            timestamp = point.get("timestamp_utc")
            mid_price = point.get("mid_price")
            if timestamp is None or mid_price is None:
                continue
            # Later points overwrite earlier ones, so each day keeps its last known price.
            prices[datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc).date()] = float(
                mid_price
            )
        return prices


def _share_moves_by_isin(raw_transactions: list[dict]) -> dict[str, list[tuple[date, float]]]:
    moves: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for raw in raw_transactions:
        if raw.get("summary_type") not in _ISIN_SUMMARY_TYPES:
            continue
        isin = raw.get("isin")
        quantity = _quantity(raw)
        sign = _SHARE_MOVE_SIGN.get(_transaction_type(raw))
        if not isin or quantity is None or sign is None:
            continue
        moves[isin].append((_event_date(raw), sign * quantity))
    return moves


class ScalableCapitalHandler(BankHandler):
    CREDENTIAL_FIELDS: tuple[str, ...] = ()

    def begin_two_factor_challenge(self, credential_id: int) -> TwoFactorChallenge:
        ensure_cli_binary_available()
        # Plain sync call: the pending subprocess must outlive this call's event loop.
        challenge_token, authorization_url, device_code, expires_at = scalable_capital_login.start(
            credential_id=credential_id
        )
        return TwoFactorChallenge(
            challenge_token=challenge_token,
            expires_at=expires_at,
            authorization_url=authorization_url,
            device_code=device_code,
        )

    def complete_two_factor_challenge(self, challenge_token: str, credential_id: int, code: str) -> dict:
        # `code` is unused: the device-code flow never produces one to submit back
        return scalable_capital_login.complete(challenge_token=challenge_token, credential_id=credential_id)

    @contextmanager
    def session(self) -> Iterator[_ScalableCapitalSession]:
        if not self.session_state:
            raise ReauthenticationRequiredError("Not authorized yet.")
        ensure_cli_binary_available()

        config_dir = Path(tempfile.mkdtemp(prefix="scalable-cli-session-"))
        try:
            try:
                scalable_capital_login.write_session_state(config_dir=config_dir, session_state=self.session_state)
            except ValueError as e:
                raise ReauthenticationRequiredError(f"Session state is unusable: {e}") from e
            yield _ScalableCapitalSession(config_dir=config_dir)
            self.session_state = scalable_capital_login.read_session_state(config_dir)
        finally:
            shutil.rmtree(config_dir, ignore_errors=True)
