import asyncio
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from pytr.api import TradeRepublicApi
from source.bank_handlers.base import BankHandler, BankSession, FetchedAccount
from source.exceptions import ReauthenticationRequiredError


class _TradeRepublicSession(BankSession):
    def __init__(self, tr: TradeRepublicApi):
        super().__init__()
        self._tr = tr

    def get_accounts(self) -> list[FetchedAccount]:
        asyncio.run(self._fetch())
        return [FetchedAccount(name=account_name) for account_name in self._account_mapping.keys()]

    def get_balance(self, account: FetchedAccount) -> float:
        return round(number=self._account_mapping[account.name]["balance"], ndigits=2)

    async def _fetch(self) -> None:
        calls = {"cash", "compact_portfolio"}
        for call in calls:
            await getattr(self._tr, call)()

        try:
            responses_received = 0
            while responses_received < len(calls):
                _sub_id, subscription, response = await self._tr.recv()
                subscription_type = subscription["type"]
                if subscription_type == "cash":
                    for entry in response:
                        self._account_mapping[entry["accountNumber"]] = {"balance": float(entry["amount"])}
                elif subscription_type == "compactPortfolio":
                    for position in response["positions"]:
                        self._account_mapping[position["instrumentId"]] = {
                            "balance": float(position["averageBuyIn"]) * float(position["netSize"])
                        }
                responses_received += 1
        finally:
            await self._tr.close()


class TradeRepublicHandler(BankHandler):
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
                phone_no=self.username, pin=self.password, save_cookies=True, cookies_file=str(cookies_path)
            )
            try:
                resumed = bool(stored) and trade_republic_client.resume_websession()
            except Exception:
                resumed = False
            if not resumed:
                raise ReauthenticationRequiredError(
                    "Trade Republic websession expired; 2FA re-authentication required."
                )

            yield _TradeRepublicSession(trade_republic_client)

            self.session_state = {"cookies": cookies_path.read_text()}
        finally:
            cookies_path.unlink(missing_ok=True)
