import secrets
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Iterator
from urllib.parse import parse_qs, urlsplit

import jwt
from requests import Response

from source.backend.bank_handlers.base import (
    BalanceObservation,
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
    FieldRule,
    TwoFactorChallenge,
)
from source.backend.exceptions import (
    InvalidCredentialsError,
    PSD2ApplicationNotActivatedError,
    PSD2RedirectUrlNotAllowedError,
    ReauthenticationRequiredError,
)
from source.backend.helpers import RestAPIClient, utc_now
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

API_BASE = "https://api.enablebanking.com"
_JWT_LIFETIME = timedelta(hours=1)
_TIMEOUT_FOR_USER_TO_COMPLETE_BANKS_AUTH_FLOW = timedelta(minutes=15)
_REQUESTED_PSD2_CONSENT_VALIDITY = timedelta(days=179)  # ASPSPs cap it at their own maximum (mostly 180 days)
_BALANCE_TYPE_PREFERENCE = ("CLBD", "XPCD", "CLAV", "ITBD", "ITAV")  # Prefer settled balances


def _make_jwt(application_id: str, private_key_pem: str) -> str:
    now = utc_now().replace(tzinfo=timezone.utc)
    payload = {
        "iss": "enablebanking.com",
        "aud": "api.enablebanking.com",
        "iat": now,
        "exp": now + _JWT_LIFETIME,
    }
    try:
        return jwt.encode(payload=payload, key=private_key_pem, algorithm="RS256", headers={"kid": application_id})
    except (ValueError, TypeError, jwt.exceptions.InvalidKeyError) as e:
        raise InvalidCredentialsError(f"Enable Banking private key could not be loaded: {e}") from e


class _EnableBankingApi(RestAPIClient):
    def __init__(self, application_id: str, private_key_pem: str):
        super().__init__(name="Enable Banking", base_url=API_BASE)
        self.http.headers["Authorization"] = (
            f"Bearer {_make_jwt(application_id=application_id, private_key_pem=private_key_pem)}"
        )

    def request(
        self,
        method: str,
        path: str,
        json_body: dict | None = None,
        params: dict | None = None,
        data: dict | None = None,
    ) -> Response:
        response = super().request(method=method, path=path, json_body=json_body, params=params, data=data)
        if response.status_code in (401, 403):
            if "not active" in response.text.lower():
                raise PSD2ApplicationNotActivatedError(
                    "The Enable Banking application is not active yet; an account has to be "
                    "linked in the control panel first."
                )
            raise InvalidCredentialsError(
                f"Enable Banking rejected the application credentials ({response.status_code}): {response.text}"
            )
        return response


class _EnableBankingSession(BankSession):
    def __init__(self, api: _EnableBankingApi, accounts: list[dict], transaction_history_incomplete: bool):
        self._api = api
        self._accounts = accounts
        self._transaction_history_incomplete = transaction_history_incomplete
        self._uid_by_name: dict[str, str] = {}
        self._balance_by_name: dict[str, float] = {}

    def get_accounts(self) -> list[FetchedAccount]:
        for account in self._accounts:
            self._uid_by_name[self._account_name(account)] = account["uid"]
        logger.debug(f"Enable Banking session exposes {len(self._uid_by_name)} account(s)")
        return [
            FetchedAccount(name=name, transaction_history_incomplete=self._transaction_history_incomplete)
            for name in self._uid_by_name
        ]

    @staticmethod
    def _account_name(account: dict) -> str:
        account_id = account.get("account_id") or {}
        other_id = account_id.get("other") or {}
        return (
            account.get("name")
            or account.get("product")
            or account_id.get("iban")
            or other_id.get("identification")
            or "Account"
        )

    def get_balance(self, account: FetchedAccount) -> float:
        balances = self._api.get(f"/accounts/{self._uid_by_name[account.name]}/balances").get("balances") or []
        if not balances:
            return 0.0
        by_type: dict[str, dict] = {}
        for balance in balances:
            existing = by_type.get(balance.get("balance_type"))
            if existing is None or (
                existing["balance_amount"]["currency"] != "EUR" and balance["balance_amount"]["currency"] == "EUR"
            ):
                by_type[balance.get("balance_type")] = balance
        chosen = next((by_type[t] for t in _BALANCE_TYPE_PREFERENCE if t in by_type), balances[0])
        balance = float(chosen["balance_amount"]["amount"])
        self._balance_by_name[account.name] = balance
        return balance

    def get_balance_observations(self, account: FetchedAccount) -> list[BalanceObservation]:
        if account.name not in self._balance_by_name:
            return []
        return [BalanceObservation(date=date.today(), amount=self._balance_by_name[account.name])]

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        uid = self._uid_by_name[account.name]
        transactions = []
        continuation_key: str | None = None
        while True:
            params = {"date_from": start_date.isoformat()}
            if continuation_key:
                params["continuation_key"] = continuation_key
            page = self._api.get(f"/accounts/{uid}/transactions", params=params)
            for raw_transaction in page.get("transactions") or []:
                fetched = _to_fetched_transaction(raw_transaction)
                if fetched is not None:
                    transactions.append(fetched)
            continuation_key = page.get("continuation_key")
            if not continuation_key:
                break
        logger.debug(f"Enable Banking returned {len(transactions)} transaction(s) for {account.name}")
        return transactions


def _to_fetched_transaction(raw: dict) -> FetchedTransaction | None:
    status = raw.get("status")
    if status not in ("BOOK", "PDNG"):  # ignore informational/rejected entries
        return None

    transaction_date = raw.get("booking_date") or raw.get("value_date") or raw.get("transaction_date")
    if not transaction_date:
        return None

    amount = float(raw["transaction_amount"]["amount"])
    if raw.get("credit_debit_indicator") == "DBIT":
        amount = -amount
    remittance = raw.get("remittance_information") or []
    purpose = " ".join(remittance) if isinstance(remittance, list) else str(remittance)
    counterparty = (raw.get("creditor") if amount < 0 else raw.get("debtor")) or {}
    return FetchedTransaction(
        amount=amount,
        purpose=purpose or None,
        date=date.fromisoformat(transaction_date),
        other_party=counterparty.get("name"),
        pending=status == "PDNG",
    )


class EnableBankingHandler(BankHandler):
    CREDENTIAL_FIELDS = ("application_id", "private_key", "redirect_url", "aspsp_name", "aspsp_country")
    FIELD_RULES = {
        "application_id": (
            FieldRule(
                name="application_id_uuid",
                regex=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                description="be the application ID (a UUID) from the Enable Banking control panel",
            ),
        ),
        "private_key": (
            FieldRule(
                name="private_key_pem",
                regex=r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
                description="be the PEM private key file downloaded when registering the application",
            ),
        ),
        "redirect_url": (
            FieldRule(
                name="redirect_url_https",
                regex=r"^https://",
                description="be an HTTPS URL (Enable Banking requires the app to be served over HTTPS)",
            ),
        ),
    }
    WHITESPACE_STRIPPED_FIELDS = frozenset({"application_id"})

    def _api(self) -> _EnableBankingApi:
        return _EnableBankingApi(
            application_id=self.credentials["application_id"], private_key_pem=self.credentials["private_key"]
        )

    def begin_two_factor_challenge(self, credential_id: int) -> TwoFactorChallenge:
        api = self._api()
        response = api.request(
            method="POST",
            path="/auth",
            json_body={
                "access": {"valid_until": (datetime.now(timezone.utc) + _REQUESTED_PSD2_CONSENT_VALIDITY).isoformat()},
                "aspsp": {"name": self.credentials["aspsp_name"], "country": self.credentials["aspsp_country"]},
                "state": secrets.token_urlsafe(16),
                "redirect_url": self.credentials["redirect_url"],
                "psu_type": "personal",
            },
        )
        if response.status_code == 400 and "REDIRECT_URI_NOT_ALLOWED" in response.text:
            raise PSD2RedirectUrlNotAllowedError(
                f"The redirect URL {self.credentials['redirect_url']} is not whitelisted "
                f"in the Enable Banking application."
            )
        api.raise_for_status(response=response, label="authorization could not be started")
        logger.info(f"Enable Banking authorization started for credential {credential_id}")
        return TwoFactorChallenge(
            challenge_token=secrets.token_urlsafe(16),
            expires_at=utc_now() + _TIMEOUT_FOR_USER_TO_COMPLETE_BANKS_AUTH_FLOW,
            authorization_url=response.json()["url"],
        )

    def complete_two_factor_challenge(self, challenge_token: str, credential_id: int, code: str) -> dict:
        api = self._api()
        response = api.request(method="POST", path="/sessions", json_body={"code": _extract_code(code)})
        if response.status_code == 422:
            raise InvalidCredentialsError(f"Enable Banking rejected the authorization code: {response.text}")
        api.raise_for_status(response=response, label="session could not be created")
        session = response.json()
        logger.info(f"Enable Banking session created for credential {credential_id}")
        return {"session_id": session["session_id"], "valid_until": (session.get("access") or {}).get("valid_until")}

    @contextmanager
    def session(self) -> Iterator[_EnableBankingSession]:
        session_id = (self.session_state or {}).get("session_id")
        if not session_id:
            raise ReauthenticationRequiredError("Enable Banking access has not been authorized yet.")
        api = self._api()
        response = api.request(method="GET", path=f"/sessions/{session_id}")
        if response.status_code in (404, 410, 422):
            raise ReauthenticationRequiredError("Enable Banking session no longer exists; re-authorization required.")
        api.raise_for_status(response=response, label="session lookup failed")
        session = response.json()
        if session.get("status") != "AUTHORIZED":
            raise ReauthenticationRequiredError(
                f"Enable Banking session is {session.get('status')}; re-authorization required."
            )
        accounts = [
            {"uid": account} if isinstance(account, str) else account for account in session.get("accounts") or []
        ]
        accounts = [self._with_details(api=api, account=account) for account in accounts]

        transaction_history_incomplete = self.credentials.get("aspsp_name") == "PayPal"
        yield _EnableBankingSession(
            api=api, accounts=accounts, transaction_history_incomplete=transaction_history_incomplete
        )

    @staticmethod
    def _with_details(api: _EnableBankingApi, account: dict) -> dict:
        if account.get("name") or account.get("product") or account.get("account_id"):
            return account
        return {**api.get(f"/accounts/{account['uid']}/details"), "uid": account["uid"]}


def _extract_code(code: str) -> str:
    if "://" in code:
        query = parse_qs(urlsplit(code.strip()).query)
        if query.get("code"):
            return query["code"][0]
    return code.strip()
