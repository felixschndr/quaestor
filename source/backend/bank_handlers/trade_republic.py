import asyncio
import tempfile
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Iterator

from pytr.api import TradeRepublicApi
from pytr.event import Event
from pytr.portfolio import Portfolio
from pytr.timeline import Timeline
from pytr.transactions import TransactionExporter
from source.backend.bank_handlers.base import (
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.exceptions import ReauthenticationRequiredError
from source.backend.logging_utils import get_logger
from source.backend.models.transaction_type import TransactionType

logger = get_logger(__name__)

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


class _TradeRepublicSession(BankSession):
    def __init__(self, trade_republic_client: TradeRepublicApi):
        super().__init__()

        self._trade_republic_client = trade_republic_client

        self._accounts: dict[str, dict] = {}
        self._cash_account_name: str | None = None

        self._transactions_loaded = False

    def _account(self, name: str) -> dict:
        if name not in self._accounts:
            self._accounts[name] = {"balance": 0.0, "transactions": [], "isin": None}
        return self._accounts[name]

    def _account_name_for_isin(self, isin: str) -> str | None:
        return next((name for name, state in self._accounts.items() if state["isin"] == isin), None)

    def get_accounts(self) -> list[FetchedAccount]:
        asyncio.run(self._fetch())
        return [FetchedAccount(name=account_name) for account_name in self._accounts]

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

    async def _fetch(self) -> None:
        portfolio = Portfolio(self._trade_republic_client, lang="de")
        try:
            await portfolio.portfolio_loop()
        finally:
            await self._trade_republic_client.close()

        cash = portfolio.cash[0]
        self._cash_account_name = cash["accountNumber"]
        self._account(self._cash_account_name)["balance"] = float(cash["amount"])

        for position in portfolio.portfolio:
            account = self._account(position["name"])
            account["balance"] = float(position["netValue"])
            account["isin"] = position["instrumentId"]

        logger.debug(
            f"Trade Republic portfolio fetched: {len(portfolio.cash)} cash account(s), "
            f"{len(portfolio.portfolio)} portfolio position(s)"
        )

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
                isin = row[isin_field]
                account_name = self._account_name_for_isin(isin) if isin else None
                if account_name is None:
                    account_name = self._cash_account_name
                if account_name is None:
                    continue
                self._account(account_name)["transactions"].append(
                    FetchedTransaction(
                        amount=float(value),
                        purpose=None,
                        date=date.fromisoformat(str(row[date_field])),
                        other_party=row[note_field],
                        transaction_type=_LABEL_TO_TRANSACTION_TYPE.get(row[type_field]),
                    )
                )

        logger.debug(
            f"Trade Republic timeline fetched: {len(timeline.events)} event(s) since {start_date} "
            f"across {len(self._accounts)} account(s)"
        )


class TradeRepublicHandler(BankHandler):
    CREDENTIAL_FIELDS = ("phone", "pin")

    session_state: dict | None = None

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
