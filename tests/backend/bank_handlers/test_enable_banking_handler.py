import base64
import json
from collections.abc import Callable
from datetime import date

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.padding import PKCS1v15
from cryptography.hazmat.primitives.hashes import SHA256

from source.backend import rest_api_client
from source.backend.bank_handlers import BANKS_BY_NAME
from source.backend.bank_handlers.enable_banking_handler import (
    EnableBankingHandler,
    _extract_code,
    _make_jwt,
    _to_fetched_transaction,
)
from source.backend.exceptions import (
    InvalidCredentialsError,
    PSD2ApplicationNotActivatedError,
    PSD2RedirectUrlNotAllowedError,
    ReauthenticationRequiredError,
)
from tests.backend.conftest import (
    ACCOUNT_UID,
    APPLICATION_ID,
    CHALLENGE_TOKEN,
    SESSION_ID,
    FakeHttpResponse,
)

_TEST_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_TEST_KEY_PEM = _TEST_KEY.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
).decode("ascii")


def _credentials() -> dict[str, str]:
    return {
        "application_id": APPLICATION_ID,
        "private_key": _TEST_KEY_PEM,
        "redirect_url": "https://localhost:8000/api/banking/enable_banking/callback",
        "aspsp_name": "PayPal",
        "aspsp_country": "DE",
    }


def _handler(session_state: dict | None = None) -> EnableBankingHandler:
    handler = EnableBankingHandler(bank_info=BANKS_BY_NAME["enable_banking"], credentials=_credentials())
    handler.session_state = session_state
    return handler


class FakeHttp:
    def __init__(self, routes: dict[tuple[str, str], FakeHttpResponse | list[FakeHttpResponse]]):
        self.headers: dict[str, str] = {}
        self.routes = routes
        self.requests: list[dict] = []

    def request(
        self,
        method: str,
        url: str,
        json: dict | None = None,
        params: dict | None = None,
        data: dict | None = None,
        timeout: float = 0,
    ):
        path = url.removeprefix("https://api.enablebanking.com")
        self.requests.append({"method": method, "path": path, "json": json, "params": params})
        route = self.routes[(method, path)]
        if isinstance(route, list):
            return route.pop(0)
        return route


@pytest.fixture
def fake_http(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict], FakeHttp]:
    def install(routes: dict) -> FakeHttp:
        fake = FakeHttp(routes)
        monkeypatch.setattr(target=rest_api_client, name="Session", value=lambda: fake)
        return fake

    return install


def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def test_make_jwt_is_signed_and_carries_kid():
    jwt = _make_jwt(application_id=APPLICATION_ID, private_key_pem=_TEST_KEY_PEM)

    header_b64, payload_b64, signature_b64 = jwt.split(".")
    header = json.loads(_b64url_decode(header_b64))
    payload = json.loads(_b64url_decode(payload_b64))
    assert header == {"typ": "JWT", "alg": "RS256", "kid": APPLICATION_ID}
    assert payload["iss"] == "enablebanking.com"
    assert payload["aud"] == "api.enablebanking.com"
    assert payload["exp"] == payload["iat"] + 3600
    _TEST_KEY.public_key().verify(
        signature=_b64url_decode(signature_b64),
        data=f"{header_b64}.{payload_b64}".encode("ascii"),
        padding=PKCS1v15(),
        algorithm=SHA256(),
    )


def test_make_jwt_rejects_garbage_key():
    with pytest.raises(InvalidCredentialsError):
        _make_jwt(application_id=APPLICATION_ID, private_key_pem="not a pem")


@pytest.mark.parametrize(
    argnames="input_value", argvalues=["abc-123", " abc-123 ", "https://localhost:8000/cb?state=xyz&code=abc-123"]
)
def test_extract_code_accepts_code_and_full_redirect_url(input_value: str):
    assert _extract_code(input_value) == "abc-123"


def test_transaction_mapping_signs_and_dates():
    booked = _to_fetched_transaction(
        {
            "status": "BOOK",
            "entry_reference": "ref-42",
            "transaction_amount": {"currency": "EUR", "amount": "17.88"},
            "credit_debit_indicator": "DBIT",
            "booking_date": None,
            "value_date": None,
            "transaction_date": "2026-06-25",
            "remittance_information": [],
            "creditor": {"name": "Serverprofis GmbH"},
            "debtor": {"name": None},
        }
    )
    assert booked is not None
    assert booked.amount == -17.88
    assert booked.date == date(year=2026, month=6, day=25)
    assert booked.other_party == "Serverprofis GmbH"
    assert booked.purpose is None
    assert booked.pending is False
    assert booked.bank_reference == "ref-42"

    credit = _to_fetched_transaction(
        {
            "status": "PDNG",
            "entry_reference": "",
            "transaction_amount": {"currency": "EUR", "amount": "5.00"},
            "credit_debit_indicator": "CRDT",
            "booking_date": "2026-07-01",
            "remittance_information": ["thanks", "for lunch"],
            "debtor": {"name": "Nipper"},
        }
    )
    assert credit is not None
    assert credit.amount == 5.00
    assert credit.purpose == "thanks for lunch"
    assert credit.other_party == "Nipper"
    assert credit.pending is True
    assert credit.bank_reference is None


def test_transaction_mapping_skips_undateable_and_info_entries():
    assert _to_fetched_transaction({"status": "RJCT"}) is None
    assert (
        _to_fetched_transaction(
            {"status": "BOOK", "transaction_amount": {"amount": "1.00"}, "credit_debit_indicator": "CRDT"}
        )
        is None
    )


def test_session_without_state_requires_reauthentication(fake_http: Callable[[dict], FakeHttp]):
    fake_http({})
    with pytest.raises(ReauthenticationRequiredError):
        with _handler(session_state=None).session():
            pass


def test_session_with_expired_session_requires_reauthentication(fake_http: Callable[[dict], FakeHttp]):
    fake_http({("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(json_data={"status": "EXPIRED"}, status_code=200)})
    with pytest.raises(ReauthenticationRequiredError):
        with _handler(session_state={"session_id": SESSION_ID}).session():
            pass


def test_session_gone_requires_reauthentication(fake_http: Callable[[dict], FakeHttp]):
    fake_http({("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(json_data={}, status_code=404)})
    with pytest.raises(ReauthenticationRequiredError):
        with _handler(session_state={"session_id": SESSION_ID}).session():
            pass


def test_session_rejected_jwt_raises_invalid_credentials(fake_http: Callable[[dict], FakeHttp]):
    fake_http({("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(json_data={}, status_code=401)})
    with pytest.raises(InvalidCredentialsError):
        with _handler(session_state={"session_id": SESSION_ID}).session():
            pass


def test_session_fetches_accounts_balances_and_paginated_transactions(fake_http: Callable[[dict], FakeHttp]):
    transactions_page_one = FakeHttpResponse(
        json_data={
            "transactions": [
                {
                    "status": "BOOK",
                    "transaction_amount": {"currency": "EUR", "amount": "21.99"},
                    "credit_debit_indicator": "DBIT",
                    "transaction_date": "2026-07-13",
                    "creditor": {"name": "Spotify AB"},
                }
            ],
            "continuation_key": "page2",
        }
    )
    transactions_page_two = FakeHttpResponse(
        json_data={
            "transactions": [
                {
                    "status": "BOOK",
                    "transaction_amount": {"currency": "EUR", "amount": "100.00"},
                    "credit_debit_indicator": "CRDT",
                    "transaction_date": "2026-07-08",
                    "debtor": {"name": "Alice"},
                }
            ],
            "continuation_key": None,
        }
    )
    fake = fake_http(
        {
            ("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(
                json_data={"status": "AUTHORIZED", "accounts": [ACCOUNT_UID]}
            ),
            ("GET", f"/accounts/{ACCOUNT_UID}/details"): FakeHttpResponse(
                json_data={"name": "Felix Schneider", "product": "PAYPAL_PREMIER_ACCOUNT", "account_id": None}
            ),
            ("GET", f"/accounts/{ACCOUNT_UID}/balances"): FakeHttpResponse(
                json_data={
                    "balances": [
                        {"balance_type": "XPCD", "balance_amount": {"currency": "EUR", "amount": "12.34"}},
                    ]
                }
            ),
            ("GET", f"/accounts/{ACCOUNT_UID}/transactions"): [transactions_page_one, transactions_page_two],
        }
    )

    with _handler(session_state={"session_id": SESSION_ID}).session() as bank:
        accounts = bank.get_accounts()
        assert [account.name for account in accounts] == ["Felix Schneider"]
        assert bank.get_balance(accounts[0]) == 12.34
        transactions = bank.get_transactions(account=accounts[0], start_date=date(year=2026, month=6, day=1))

    assert [transaction.amount for transaction in transactions] == [-21.99, 100.00]
    transaction_requests = [r for r in fake.requests if r["path"].endswith("/transactions")]
    assert transaction_requests[0]["params"] == {"date_from": "2026-06-01"}
    assert transaction_requests[1]["params"] == {"date_from": "2026-06-01", "continuation_key": "page2"}


def test_balance_prefers_settled_over_expected(fake_http: Callable[[dict], FakeHttp]):
    fake_http(
        {
            ("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(
                json_data={
                    "status": "AUTHORIZED",
                    "accounts": [{"uid": ACCOUNT_UID, "name": "PayPal", "account_id": None, "product": "X"}],
                }
            ),
            ("GET", f"/accounts/{ACCOUNT_UID}/balances"): FakeHttpResponse(
                json_data={
                    "balances": [
                        {"balance_type": "XPCD", "balance_amount": {"currency": "EUR", "amount": "1.00"}},
                        {"balance_type": "CLBD", "balance_amount": {"currency": "EUR", "amount": "2.00"}},
                    ]
                }
            ),
        }
    )

    with _handler(session_state={"session_id": SESSION_ID}).session() as bank:
        accounts = bank.get_accounts()
        assert bank.get_balance(accounts[0]) == 2.00


def test_begin_two_factor_challenge_returns_authorization_url(fake_http: Callable[[dict], FakeHttp]):
    fake = fake_http(
        {("POST", "/auth"): FakeHttpResponse(json_data={"url": "https://tilisy.enablebanking.com/ais/start?x=1"})}
    )

    challenge = _handler().begin_two_factor_challenge(credential_id=7)

    assert challenge.authorization_url == "https://tilisy.enablebanking.com/ais/start?x=1"
    assert challenge.challenge_token
    body = fake.requests[0]["json"]
    assert body["aspsp"] == {"name": "PayPal", "country": "DE"}
    assert body["psu_type"] == "personal"
    assert body["redirect_url"] == _credentials()["redirect_url"]
    assert body["access"]["valid_until"].endswith("+00:00")  # The API rejects naive timestamps


def test_begin_two_factor_challenge_with_inactive_application_raises_specific_error(
    fake_http: Callable[[dict], FakeHttp],
):
    fake_http({("POST", "/auth"): FakeHttpResponse(json_data={}, status_code=403, text="Application is not active")})
    with pytest.raises(PSD2ApplicationNotActivatedError):
        _handler().begin_two_factor_challenge(credential_id=7)


def test_begin_two_factor_challenge_with_rejected_jwt_raises_invalid_credentials(
    fake_http: Callable[[dict], FakeHttp],
):
    fake_http({("POST", "/auth"): FakeHttpResponse(json_data={}, status_code=401, text="Invalid JWT")})
    with pytest.raises(InvalidCredentialsError):
        _handler().begin_two_factor_challenge(credential_id=7)


def test_complete_two_factor_challenge_creates_session_from_redirect_url(fake_http: Callable[[dict], FakeHttp]):
    fake = fake_http(
        {
            ("POST", "/sessions"): FakeHttpResponse(
                json_data={"session_id": SESSION_ID, "access": {"valid_until": "2027-01-09T13:24:20Z"}}
            )
        }
    )

    state = _handler().complete_two_factor_challenge(
        challenge_token=CHALLENGE_TOKEN,
        credential_id=7,
        code="https://localhost:8000/cb?state=xyz&code=the-code",
    )

    assert state == {"session_id": SESSION_ID, "valid_until": "2027-01-09T13:24:20Z"}
    assert fake.requests[0]["json"] == {"code": "the-code"}


def test_complete_two_factor_challenge_rejects_bad_code(fake_http: Callable[[dict], FakeHttp]):
    fake_http({("POST", "/sessions"): FakeHttpResponse(json_data={}, status_code=422, text="bad code")})
    with pytest.raises(InvalidCredentialsError):
        _handler().complete_two_factor_challenge(challenge_token=CHALLENGE_TOKEN, credential_id=7, code="nope")


def test_begin_two_factor_challenge_with_unlisted_redirect_url_raises_specific_error(
    fake_http: Callable[[dict], FakeHttp],
):
    fake_http(
        {
            ("POST", "/auth"): FakeHttpResponse(
                json_data={},
                status_code=400,
                text='{"code":400,"message":"Redirect URI not allowed","error":"REDIRECT_URI_NOT_ALLOWED"}',
            )
        }
    )
    with pytest.raises(PSD2RedirectUrlNotAllowedError, match="not whitelisted"):
        _handler().begin_two_factor_challenge(credential_id=7)


def test_paypal_accounts_are_marked_history_incomplete_and_anchor_todays_balance(
    fake_http: Callable[[dict], FakeHttp],
):
    fake_http(
        {
            ("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(
                json_data={
                    "status": "AUTHORIZED",
                    "accounts": [{"uid": ACCOUNT_UID, "name": "PayPal", "account_id": None, "product": "X"}],
                }
            ),
            ("GET", f"/accounts/{ACCOUNT_UID}/balances"): FakeHttpResponse(
                json_data={
                    "balances": [{"balance_type": "XPCD", "balance_amount": {"currency": "EUR", "amount": "7.50"}}]
                }
            ),
        }
    )

    with _handler(session_state={"session_id": SESSION_ID}).session() as bank:
        accounts = bank.get_accounts()
        assert accounts[0].transaction_history_incomplete is True
        assert bank.get_balance_observations(accounts[0]) == []  # balance not fetched yet
        assert bank.get_balance(accounts[0]) == 7.50
        observations = bank.get_balance_observations(accounts[0])

    assert len(observations) == 1
    assert observations[0].amount == 7.50
    assert observations[0].date == date.today()


def test_non_paypal_accounts_keep_complete_history(fake_http: Callable[[dict], FakeHttp]):
    fake_http(
        {
            ("GET", f"/sessions/{SESSION_ID}"): FakeHttpResponse(
                json_data={
                    "status": "AUTHORIZED",
                    "accounts": [{"uid": ACCOUNT_UID, "name": "Giro", "account_id": None, "product": "X"}],
                }
            ),
        }
    )
    handler = EnableBankingHandler(
        bank_info=BANKS_BY_NAME["enable_banking"], credentials={**_credentials(), "aspsp_name": "N26"}
    )
    handler.session_state = {"session_id": SESSION_ID}

    with handler.session() as bank:
        assert bank.get_accounts()[0].transaction_history_incomplete is False
