import asyncio
import tempfile
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterator, TypedDict

from pytr.api import TradeRepublicApi
from pytr.event import Event
from pytr.timeline import Timeline
from pytr.transactions import TransactionExporter

from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
    FieldRule,
    TwoFactorChallenge,
)
from source.backend.exceptions import ReauthenticationRequiredError
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType
from source.backend.services.banking import trade_republic_login

logger = get_logger(__name__)

# pytr's performance_history() targets the retired `aggregateHistory` topic; the live API serves
# instrument price history under `aggregateHistoryLight`. `max` + an explicit daily resolution yields
# one close per trading day over the full history (without it, long ranges collapse to weekly points).
_PRICE_HISTORY_TOPIC = "aggregateHistoryLight"
_PRICE_HISTORY_RANGE = "max"
_DAILY_RESOLUTION_MS = 86_400_000
_DEFAULT_EXCHANGE = "LSX"
# Share history must reach back to the first trade, independent of the incremental transaction window.
_FULL_HISTORY_START = date(year=2000, month=1, day=1)
# Only buys and sells change the holding; other events carry no share movement.
_SHARE_MOVE_SIGN: dict[TransactionType, float] = {TransactionType.BUY: 1.0, TransactionType.SELL: -1.0}

# We need an own mapping since the pytr exporter does not output the enums but text instead
# Thus, we have to convert it back
_LABEL_TO_TRANSACTION_TYPE: dict[str, TransactionType] = {
    "Buy": TransactionType.BUY,
    "Sell": TransactionType.SELL,
    "Deposit": TransactionType.DEPOSIT,
    "Removal": TransactionType.REMOVAL,
    "Dividend": TransactionType.DIVIDEND,
    "Interest": TransactionType.INTEREST,
    "Interest Charge": TransactionType.INTEREST_CHARGE,
    "Taxes": TransactionType.TAXES,
    "Tax Refund": TransactionType.TAX_REFUND,
    "Fees": TransactionType.FEES,
    "Fees Refund": TransactionType.FEES_REFUND,
    "Spinoff": TransactionType.SPINOFF,
    "Split": TransactionType.SPLIT,
    "Swap": TransactionType.SWAP,
    "Transfer (Inbound)": TransactionType.TRANSFER_IN,
    "Transfer (Outbound)": TransactionType.TRANSFER_OUT,
}


class _AccountState(TypedDict):
    balance: float
    transactions: list[FetchedTransaction]
    isin: str | None  # None for the cash account, the instrument ISIN for a position


class _TradeRepublicSession(BankSession):
    def __init__(self, trade_republic_client: TradeRepublicApi):
        self._trade_republic_client = trade_republic_client

        self._accounts: dict[str, _AccountState] = {}
        self._cash_account_name: str | None = None

        self._transactions_loaded = False
        self._value_history: dict[str, list[BalanceObservation]] | None = None

    def _account(self, name: str) -> _AccountState:
        if name not in self._accounts:
            self._accounts[name] = {"balance": 0.0, "transactions": [], "isin": None}
        return self._accounts[name]

    def _account_name_for_isin(self, isin: str) -> str | None:
        return next((name for name, state in self._accounts.items() if state["isin"] == isin), None)

    def get_accounts(self) -> list[FetchedAccount]:
        asyncio.run(self._fetch())
        return [
            # The cash account's "name" is already its accountNumber (stable); positions carry their ISIN.
            FetchedAccount(name=account_name, external_id=state["isin"] or account_name)
            for account_name, state in self._accounts.items()
        ]

    def get_balance(self, account: FetchedAccount) -> float:
        return round(number=self._account(account.name)["balance"], ndigits=2)

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        if not self._transactions_loaded:
            asyncio.run(self._fetch_transactions(start_date))
            self._transactions_loaded = True
        transactions = self._account(account.name)["transactions"]
        logger.debug(
            f"Trade Republic returned {len(transactions)} transaction(s) for {account.name} since {start_date}"
        )
        return transactions

    def get_market_value_history(self, account: FetchedAccount) -> list[BalanceObservation]:
        if self._account(account.name)["isin"] is None:  # cash account -> transaction-driven balance
            return []
        if self._value_history is None:
            self._value_history = asyncio.run(self._fetch_value_history())
        return self._value_history.get(account.name) or []

    async def _fetch(self) -> None:
        # We bypass pytr's Portfolio.portfolio_loop() because it subscribes to the
        # retired `compactPortfolio` topic, which Trade Republic now rejects with
        # BAD_SUBSCRIPTION_TYPE ("Unknown topic type: compactPortfolio.31"); the legacy
        # `portfolio` topic is gone too. `compactPortfolioByType` is the live
        # replacement, but it carries no market value, so (like portfolio_loop did
        # internally) we value each position ourselves from a live ticker quote.
        try:
            cash_accounts = await self._subscribe_once(payload={"type": "cash"}, expected_type="cash")
            positions = await self._fetch_positions()
            valued_positions: list[tuple[dict, float]] = []
            for position in positions:
                valued_positions.append((position, await self._position_net_value(position)))
        finally:
            await self._trade_republic_client.close()

        cash = cash_accounts[0]
        cash_account_name: str = cash["accountNumber"]
        self._cash_account_name = cash_account_name
        self._account(cash_account_name)["balance"] = float(cash["amount"])

        for position, net_value in valued_positions:
            account = self._account(position["name"])
            account["balance"] = net_value
            account["isin"] = position["isin"]

        logger.debug(f"Trade Republic portfolio fetched: {len(positions)} portfolio position(s)")

    async def _fetch_positions(self) -> list[dict]:
        # compactPortfolioByType groups holdings by category (stocksAndETFs, bonds, ...); flatten them.
        response = await self._subscribe_once(
            payload={"type": "compactPortfolioByType"}, expected_type="compactPortfolioByType"
        )
        return [
            position
            for category in (response.get("categories") or [])
            for position in (category.get("positions") or [])
        ]

    async def _position_net_value(self, position: dict) -> float:
        isin = position["isin"]
        exchange = await self._instrument_exchange(isin)
        ticker = await self._subscribe_once(
            payload={"type": "ticker", "id": f"{isin}.{exchange}"}, expected_type="ticker"
        )
        price = float(ticker["last"]["price"])
        # Bonds are quoted per 100 of face value while their netSize is the nominal amount.
        if position.get("bondInfo") is not None:
            price /= 100
        return round(number=price * float(position["netSize"]), ndigits=2)

    async def _fetch_transactions(self, start_date: date) -> None:
        # Mirrors `pytr export_transactions`: pull the timeline, then convert each
        # event into one or more FetchedTransaction objects
        not_before = datetime.combine(date=start_date, time=datetime.min.time()).astimezone().timestamp()
        with tempfile.TemporaryDirectory() as output_dir:
            timeline = Timeline(
                tr=self._trade_republic_client,
                output_path=Path(output_dir),
                not_before=not_before,
                store_event_database=False,
                scan_for_duplicates=False,
                dump_raw_data=False,
            )
            await timeline.tl_loop()

        exporter = TransactionExporter(lang="en", date_with_time=False, decimal_localization=False)
        date_field, type_field, value_field, note_field, isin_field = exporter.fields()[0:5]

        for raw_event in timeline.events:
            for row in exporter.from_event(Event.from_dict(raw_event)):
                value = row[value_field]
                if value is None:
                    continue
                transaction = FetchedTransaction(
                    amount=float(value),
                    purpose=None,
                    date=date.fromisoformat(str(row[date_field])),
                    other_party=row[note_field],
                    transaction_type=_LABEL_TO_TRANSACTION_TYPE.get(row[type_field]),
                )

                # We need to add movements for buying stock to the account of the stock AND to the cash account
                # Otherwise the running balance would be wrong in the cash account
                isin = row[isin_field]
                position_name = self._account_name_for_isin(isin) if isin else None
                if self._cash_account_name is not None:
                    self._account(self._cash_account_name)["transactions"].append(transaction)
                if position_name is not None and position_name != self._cash_account_name:
                    self._account(position_name)["transactions"].append(transaction)

        logger.debug(
            f"Trade Republic timeline fetched: {len(timeline.events)} event(s) since {start_date} "
            f"across {len(self._accounts)} account(s)"
        )

    async def _fetch_value_history(self) -> dict[str, list[BalanceObservation]]:
        # Map each securities position to its ISIN (cash accounts carry no ISIN). The walrus
        # narrows the optional ISIN to a plain str so the downstream lookups stay well-typed.
        positions = {name: isin for name, state in self._accounts.items() if (isin := state["isin"]) is not None}
        if not positions:
            return {}

        share_moves = self._share_moves_by_isin(await self._load_full_events())
        try:
            history: dict[str, list[BalanceObservation]] = {}
            for name, isin in positions.items():
                moves = sorted(share_moves.get(isin) or [])
                if not moves:
                    logger.debug(f"Trade Republic: no share moves for {name} ({isin}); skipping value history")
                    continue
                exchange = await self._instrument_exchange(isin)
                prices = await self._price_history(isin=isin, exchange=exchange)
                history[name] = self._market_value_series(name=name, isin=isin, moves=moves, prices=prices)
            return history
        finally:
            await self._trade_republic_client.close()

    async def _load_full_events(self) -> list[dict]:
        # Value history needs every buy/sell ever, so we ignore the incremental window here.
        not_before = datetime.combine(date=_FULL_HISTORY_START, time=datetime.min.time()).astimezone().timestamp()
        with tempfile.TemporaryDirectory() as output_dir:
            timeline = Timeline(
                tr=self._trade_republic_client,
                output_path=Path(output_dir),
                not_before=not_before,
                store_event_database=False,
                scan_for_duplicates=False,
                dump_raw_data=False,
            )
            await timeline.tl_loop()
        return timeline.events

    @staticmethod
    def _share_moves_by_isin(events: list[dict]) -> dict[str, list[tuple[date, float]]]:
        # A dividend or split can carry a `shares` field that is the current holding, not a movement,
        # so only buys and sells (via _SHARE_MOVE_SIGN) are accumulated.
        exporter = TransactionExporter(lang="en", date_with_time=False, decimal_localization=False)
        fields = exporter.fields()
        date_field, type_field, isin_field, shares_field = fields[0], fields[1], fields[4], fields[5]
        moves: dict[str, list[tuple[date, float]]] = defaultdict(list)
        for raw_event in events:
            for row in exporter.from_event(Event.from_dict(raw_event)):
                isin, shares = row[isin_field], row[shares_field]
                transaction_type = _LABEL_TO_TRANSACTION_TYPE.get(row[type_field])
                sign = _SHARE_MOVE_SIGN.get(transaction_type) if transaction_type is not None else None
                if not isin or shares in (None, "") or sign is None:
                    continue
                moves[isin].append((date.fromisoformat(str(row[date_field])), sign * float(shares)))
        return moves

    async def _instrument_exchange(self, isin: str) -> str:
        instrument = await self._subscribe_once(payload={"type": "instrument", "id": isin}, expected_type="instrument")
        exchanges = instrument.get("exchangeIds") or []
        return exchanges[0] if exchanges else _DEFAULT_EXCHANGE

    async def _price_history(self, isin: str, exchange: str) -> dict[date, float]:
        response = await self._subscribe_once(
            payload={
                "type": _PRICE_HISTORY_TOPIC,
                "id": f"{isin}.{exchange}",
                "range": _PRICE_HISTORY_RANGE,
                "resolution": _DAILY_RESOLUTION_MS,
            },
            expected_type=_PRICE_HISTORY_TOPIC,
        )
        return {
            datetime.fromtimestamp(timestamp=point["time"] / 1000, tz=timezone.utc).date(): float(point["close"])
            for point in response.get("aggregates") or []
        }

    async def _subscribe_once(self, payload: dict, expected_type: str) -> dict:
        subscription_id = await self._trade_republic_client.subscribe(payload)
        try:
            while True:
                _id, subscription, response = await self._trade_republic_client.recv()
                if subscription.get("type") == expected_type:
                    return response
        finally:
            await self._trade_republic_client.unsubscribe(subscription_id)

    @staticmethod
    def _market_value_series(
        name: str, isin: str, moves: list[tuple[date, float]], prices: dict[date, float]
    ) -> list[BalanceObservation]:
        if not prices:
            logger.debug(f"Trade Republic: no price history for {name} ({isin}); skipping value history")
            return []
        first_trade = moves[0][0]
        held = 0.0
        next_move = 0
        observations: list[BalanceObservation] = []
        for day in sorted(prices):
            while next_move < len(moves) and moves[next_move][0] <= day:
                held += moves[next_move][1]
                next_move += 1
            if day >= first_trade:
                observations.append(BalanceObservation(date=day, amount=round(number=held * prices[day], ndigits=2)))
        logger.debug(
            f"Trade Republic valued {name} ({isin}): {len(observations)} daily snapshot(s) "
            f"from {len(moves)} share move(s)"
        )
        return observations


class TradeRepublicHandler(BankHandler):
    CREDENTIAL_FIELDS = ("phone", "pin")
    FIELD_RULES = {
        "phone": (
            FieldRule(name="phone_country_code", regex=r"^\+", description="start with a country code (e.g. +49)"),
        ),
        "pin": (FieldRule(name="pin_four_digits", regex=r"^\d{4}$", description="be exactly 4 digits"),),
    }
    WHITESPACE_STRIPPED_FIELDS = frozenset({"phone"})

    def begin_two_factor_challenge(self, credential_id: int) -> TwoFactorChallenge:
        token, expires_at = trade_republic_login.start(
            credential_id=credential_id,
            phone_no=self.credentials["phone"],
            pin=self.credentials["pin"],
        )
        return TwoFactorChallenge(challenge_token=token, expires_at=expires_at)

    def complete_two_factor_challenge(self, challenge_token: str, credential_id: int, code: str) -> dict:
        cookies = trade_republic_login.complete(challenge_token=challenge_token, credential_id=credential_id, code=code)
        return {"cookies": cookies}

    @contextmanager
    def session(self) -> Iterator[_TradeRepublicSession]:
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as temp_file:
            cookies_path = Path(temp_file.name)
            stored = (self.session_state or {}).get("cookies")
            if stored:
                temp_file.write(stored)
        try:
            trade_republic_client = TradeRepublicApi(
                phone_no=self.credentials["phone"],
                pin=self.credentials["pin"],
                save_cookies=True,
                cookies_file=str(cookies_path),
            )
            try:
                resumed = bool(stored) and trade_republic_client.resume_websession()
            except Exception:
                resumed = False
            if not resumed:
                logger.info("Trade Republic websession could not be resumed; 2FA re-authentication required")
                raise ReauthenticationRequiredError(
                    "Trade Republic websession expired; 2FA re-authentication required."
                )

            logger.debug("Trade Republic websession resumed")
            yield _TradeRepublicSession(trade_republic_client)

            self.session_state = {"cookies": cookies_path.read_text()}
        finally:
            cookies_path.unlink(missing_ok=True)
