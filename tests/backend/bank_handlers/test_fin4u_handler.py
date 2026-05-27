import base64
import textwrap

import pytest
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.padding import MGF1, OAEP
from cryptography.hazmat.primitives.hashes import SHA1, SHA256
from source.backend.bank_handlers import fin4u_handler
from source.backend.bank_handlers.base import FetchedAccount
from source.backend.bank_handlers.fin4u_handler import Fin4uHandler, _Fin4uSession
from source.backend.exceptions import InvalidCredentialsError, UnknownInternalError

from tests.backend.conftest import HTTP_SESSION_TOKEN, USER_NAME, VALID_PASSWORD

# A throwaway RSA-2048 keypair
_TEST_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_TEST_PUBLIC_KEY_PEM = _TEST_PRIVATE_KEY.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
)


# Shaped after the real SPA index
# The only thing the handler cares about is matching `<script src="main.<hash>.js"`
SPA_INDEX_HTML = textwrap.dedent("""
    <html><head><title>fin4u</title></head><body>
    <app-root></app-root>
    <script src="runtime.deadbeef.js" type="module"></script>
    <script src="main.abc123def456.js" type="module"></script>
    </body></html>
    """).strip()


def _build_bundle(public_key_pem: bytes = _TEST_PUBLIC_KEY_PEM, api_version: str = "20260527") -> str:
    # Minified bundle fragment containing the two values the handler scrapes.
    # Mirrors the real layout: a "fin4u-<x.y>" version marker, then a one-char
    # minified variable bound to the YYYYMMDD API version literal. Crucially
    # `=` (chained var-assignment) not `:` (object literal) — that's how the
    # real bundle minifies, and the API_VERSION regex anchors on it.
    return 'var foo="bar";\n' + public_key_pem.decode("ascii") + f'\nvar D="fin4u-2.0",_="{api_version}",P=1e3;\n'


class _MockedResponse:
    def __init__(self, *, text: str = "", json_data: object = None, status_code: int = 200) -> None:
        self.text = text
        self._json = json_data
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error", response=self)

    def json(self) -> object:
        return self._json


class MockedSession:
    def __init__(
        self,
        spa_html: str = SPA_INDEX_HTML,
        bundle_text: str | None = None,
        token_status: int = 200,
        insurance_status: int = 200,
        insurance_data: dict | None = None,
        access_token: str | None = HTTP_SESSION_TOKEN,
    ) -> None:
        self.spa_html = spa_html
        self.bundle_text = bundle_text if bundle_text is not None else _build_bundle()
        self.token_status = token_status
        self.insurance_status = insurance_status
        self.insurance_data = insurance_data if insurance_data is not None else {"totalAssetValue": 381.4}
        self.access_token = access_token
        self.calls: list[tuple[str, str, dict]] = []

    def __enter__(self) -> "MockedSession":
        return self

    def __exit__(self, *args: object) -> bool:
        return False

    def get(self, url: str, **kwargs: object) -> _MockedResponse:
        self.calls.append(("GET", url, kwargs))
        if url == f"{_Fin4uSession.BASE_URL}/":
            return _MockedResponse(text=self.spa_html)
        if "main.abc123def456.js" in url:
            return _MockedResponse(text=self.bundle_text)
        if "/dashboard/insurance" in url:
            return _MockedResponse(status_code=self.insurance_status, json_data=self.insurance_data)
        raise AssertionError(f"unexpected GET {url}")

    def post(self, url: str, **kwargs: object) -> _MockedResponse:
        self.calls.append(("POST", url, kwargs))
        if url.endswith(_Fin4uSession.TOKEN_PATH):
            body: dict[str, object] = {"access_token": self.access_token} if self.access_token else {}
            return _MockedResponse(status_code=self.token_status, json_data=body)
        raise AssertionError(f"unexpected POST {url}")


def patch_session(monkeypatch: pytest.MonkeyPatch, fake: MockedSession) -> None:
    monkeypatch.setattr(target=fin4u_handler, name="Session", value=lambda: fake)


def fin4u_session() -> _Fin4uSession:
    return _Fin4uSession(username=USER_NAME, password=VALID_PASSWORD)


def test_load_bundle_secrets_extracts_pubkey_and_version(monkeypatch: pytest.MonkeyPatch):
    mocked_session = MockedSession()
    patch_session(monkeypatch=monkeypatch, fake=mocked_session)

    fin4u_session().get_balance(FetchedAccount(name=_Fin4uSession.ACCOUNT_NAME))

    bundle_calls = [c for c in mocked_session.calls if "main." in c[1]]
    assert len(bundle_calls) == 1
    assert bundle_calls[0][1].endswith("/main.abc123def456.js")
    insurance_calls = [c for c in mocked_session.calls if "/dashboard/insurance" in c[1]]
    assert insurance_calls[0][1] == f"{_Fin4uSession.BASE_URL}/api/20260527/dashboard/insurance"


def test_load_bundle_secrets_raises_when_bundle_url_missing(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(spa_html="<html><body>no scripts</body></html>"))

    with pytest.raises(UnknownInternalError, match="main"):
        fin4u_session().get_accounts()


def test_load_bundle_secrets_raises_when_pubkey_missing(monkeypatch: pytest.MonkeyPatch):
    patch_session(
        monkeypatch=monkeypatch,
        fake=MockedSession(bundle_text='var _config={D:"fin4u-2.0",_:"20260527"};'),
    )

    with pytest.raises(UnknownInternalError, match="public key"):
        fin4u_session().get_accounts()


def test_load_bundle_secrets_raises_when_api_version_missing(monkeypatch: pytest.MonkeyPatch):
    bundle_without_version = _TEST_PUBLIC_KEY_PEM.decode("ascii") + '\nvar x="something else";'
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(bundle_text=bundle_without_version))

    with pytest.raises(UnknownInternalError, match="API version"):
        fin4u_session().get_accounts()


def test_load_bundle_secrets_raises_when_index_request_fails(monkeypatch: pytest.MonkeyPatch):
    mocked_session = MockedSession()

    def get_500(url: str, **kwargs: object) -> _MockedResponse:
        mocked_session.calls.append(("GET", url, kwargs))
        return _MockedResponse(status_code=500)

    mocked_session.get = get_500
    patch_session(monkeypatch=monkeypatch, fake=mocked_session)

    with pytest.raises(UnknownInternalError, match="SPA index"):
        fin4u_session().get_accounts()


def test_load_bundle_secrets_raises_when_bundle_request_fails(monkeypatch: pytest.MonkeyPatch):
    mocked_session = MockedSession()
    real_get = mocked_session.get

    def selective_500(url: str, **kwargs: object) -> _MockedResponse:
        if "main.abc123def456.js" in url:
            mocked_session.calls.append(("GET", url, kwargs))
            return _MockedResponse(status_code=500)
        return real_get(url, **kwargs)

    mocked_session.get = selective_500
    patch_session(monkeypatch=monkeypatch, fake=mocked_session)

    with pytest.raises(UnknownInternalError, match="bundle unreachable"):
        fin4u_session().get_accounts()


def test_encrypt_password_round_trip_with_OAEP_SHA256_and_MGF1_SHA1():  # noqa N802
    encrypted_b64_password = _Fin4uSession._encrypt_password(plain=VALID_PASSWORD, public_key_pem=_TEST_PUBLIC_KEY_PEM)
    decrypted = _TEST_PRIVATE_KEY.decrypt(
        ciphertext=base64.b64decode(encrypted_b64_password),
        padding=OAEP(mgf=MGF1(algorithm=SHA1()), algorithm=SHA256(), label=None),  # nosec B303
    )
    assert decrypted.decode("utf-8") == VALID_PASSWORD


def test_get_accounts_returns_single_virtual_altersvorsorge_account(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession())

    accounts = fin4u_session().get_accounts()

    assert accounts == [FetchedAccount(name="Altersvorsorge")]


def test_get_balance_returns_total_asset_value(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(insurance_data={"totalAssetValue": 1234.56}))

    balance = fin4u_session().get_balance(FetchedAccount(name="Altersvorsorge"))

    assert balance == 1234.56


def test_get_transactions_is_always_empty(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession())

    transactions = fin4u_session().get_transactions(
        FetchedAccount(name="Altersvorsorge"), start_date=__import__("datetime").date(year=2020, month=1, day=1)
    )

    assert transactions == []


def test_login_request_sends_username_and_oauth_grant(monkeypatch: pytest.MonkeyPatch):
    mocked_session = MockedSession()
    patch_session(monkeypatch=monkeypatch, fake=mocked_session)

    fin4u_session().get_balance(FetchedAccount(name="Altersvorsorge"))

    [token_call] = [c for c in mocked_session.calls if c[1].endswith(_Fin4uSession.TOKEN_PATH)]
    data = token_call[2]["data"]
    assert data["username"] == USER_NAME
    assert data["grant_type"] == "password"
    assert data["client_id"] == _Fin4uSession.CLIENT_ID
    assert VALID_PASSWORD not in data["password"]  # The password is encrypted before sending
    assert len(base64.b64decode(data["password"])) == 256


def test_insurance_request_sends_bearer_token(monkeypatch: pytest.MonkeyPatch):
    mocked_session = MockedSession()
    patch_session(monkeypatch=monkeypatch, fake=mocked_session)

    fin4u_session().get_balance(FetchedAccount(name="Altersvorsorge"))

    [insurance_call] = [c for c in mocked_session.calls if "/dashboard/insurance" in c[1]]
    headers = insurance_call[2]["headers"]
    assert headers["Authorization"] == f"Bearer {HTTP_SESSION_TOKEN}"


def test_remote_data_is_only_fetched_once(monkeypatch: pytest.MonkeyPatch):
    mocked_session = MockedSession()
    patch_session(monkeypatch=monkeypatch, fake=mocked_session)
    session = fin4u_session()

    session.get_accounts()
    session.get_accounts()
    session.get_balance(FetchedAccount(name="Altersvorsorge"))

    assert len([c for c in mocked_session.calls if c[1] == f"{_Fin4uSession.BASE_URL}/"]) == 1
    assert len([c for c in mocked_session.calls if "main." in c[1]]) == 1
    assert len([c for c in mocked_session.calls if c[1].endswith(_Fin4uSession.TOKEN_PATH)]) == 1
    assert len([c for c in mocked_session.calls if "/dashboard/insurance" in c[1]]) == 1


def test_login_401_raises_invalid_credentials(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(token_status=401))

    with pytest.raises(InvalidCredentialsError):
        fin4u_session().get_accounts()


def test_login_500_raises_unknown_internal(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(token_status=500))

    with pytest.raises(UnknownInternalError):
        fin4u_session().get_accounts()


def test_token_endpoint_missing_access_token_raises_unknown_internal(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(access_token=None))

    with pytest.raises(UnknownInternalError, match="access_token"):
        fin4u_session().get_accounts()


def test_insurance_500_raises_unknown_internal(monkeypatch: pytest.MonkeyPatch):
    patch_session(monkeypatch=monkeypatch, fake=MockedSession(insurance_status=500))

    with pytest.raises(UnknownInternalError):
        fin4u_session().get_accounts()


def test_handler_session_yields_session_with_credentials():
    handler = Fin4uHandler(
        bank_info=object(),
        credentials={"username": USER_NAME, "password": VALID_PASSWORD},
    )
    with handler.session() as session:
        assert isinstance(session, _Fin4uSession)
        assert session.username == USER_NAME
        assert session.password == VALID_PASSWORD


def test_handler_declares_credential_fields():
    assert Fin4uHandler.CREDENTIAL_FIELDS == ("username", "password")
