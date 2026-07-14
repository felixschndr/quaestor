import base64
import re
from contextlib import contextmanager
from datetime import date
from typing import Iterator

from cryptography.hazmat.primitives.asymmetric.padding import MGF1, OAEP
from cryptography.hazmat.primitives.hashes import SHA1, SHA256
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from requests import HTTPError, Session
from source.backend.bank_handlers.base import (
    BankHandler,
    BankSession,
    FetchedAccount,
    FetchedTransaction,
)
from source.backend.exceptions import InvalidCredentialsError, UnknownInternalError
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

"""
fin4u seems to be an app similar to this one and supports adding multiple accounts (not only
the retirement plan). However,
1. I only use the retirement plan
2. If other accounts are added, the user would not need this app.
On the other hand there might be other (retirement or other) plans that would be beneficial to pull)
If so, please open an issue with the name of the account.
"""

_MAIN_JS_RE = re.compile(r'<script src="(main\.[a-f0-9]+\.js)"')
_PUBKEY_RE = re.compile(r"-----BEGIN PUBLIC KEY-----[A-Za-z0-9+/=\s]+?-----END PUBLIC KEY-----")
_API_VERSION_RE = re.compile(r'"fin4u-[\d.]+"\s*,\s*[A-Za-z_$]+\s*=\s*"(\d{8})"')


class _Fin4uSession(BankSession):
    BASE_URL = "https://app.fin4u.de"
    TOKEN_PATH = "/auth/realms/fin4u/protocol/openid-connect/token"  # nosec B105
    CLIENT_ID = "fin4u-portal"

    ACCOUNT_NAME = "Altersvorsorge"

    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self._balance: float | None = None
        self._fetched = False

    def get_accounts(self) -> list[FetchedAccount]:
        self._fetch()
        return [FetchedAccount(name=self.ACCOUNT_NAME)]

    def get_balance(self, account: FetchedAccount) -> float:
        self._fetch()
        assert self._balance is not None
        return self._balance

    def get_transactions(self, account: FetchedAccount, start_date: date) -> list[FetchedTransaction]:
        return []  # fin4u doesn't expose transactions

    def _fetch(self) -> None:
        if self._fetched:
            return
        with Session() as http:
            public_key_pem, api_version = self._load_bundle_secrets(http)
            token = self._login(http, public_key_pem=public_key_pem)
            self._balance = self._fetch_insurance_total(http, token=token, api_version=api_version)
        self._fetched = True
        logger.debug(f"Successfully fetched fin4u {self.username}")

    @classmethod
    def _load_bundle_secrets(cls: type["_Fin4uSession"], http: Session) -> tuple[bytes, str]:
        index = http.get(f"{cls.BASE_URL}/", timeout=15)
        try:
            index.raise_for_status()
        except HTTPError as e:
            raise UnknownInternalError(f"fin4u: SPA index unreachable: {e}") from e
        bundle_match = _MAIN_JS_RE.search(index.text)
        if not bundle_match:
            raise UnknownInternalError("fin4u: could not find main.<hash>.js in the SPA index")

        bundle = http.get(f"{cls.BASE_URL}/{bundle_match.group(1)}", timeout=30)
        try:
            bundle.raise_for_status()
        except HTTPError as e:
            raise UnknownInternalError(f"fin4u: bundle unreachable: {e}") from e

        pubkey_match = _PUBKEY_RE.search(bundle.text)
        if not pubkey_match:
            raise UnknownInternalError("fin4u: could not find PEM public key in the SPA bundle")
        version_match = _API_VERSION_RE.search(bundle.text)
        if not version_match:
            raise UnknownInternalError("fin4u: could not find API version in the SPA bundle")
        return pubkey_match.group(0).encode("ascii"), version_match.group(1)

    def _login(self, http: Session, public_key_pem: bytes) -> str:
        encrypted_password = self._encrypt_password(self.password, public_key_pem=public_key_pem)
        response = http.post(
            f"{self.BASE_URL}{self.TOKEN_PATH}",
            data={
                "username": self.username,
                "password": encrypted_password,
                "grant_type": "password",
                "client_id": self.CLIENT_ID,
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": self.BASE_URL,
            },
            timeout=15,
        )
        if response.status_code == 401:
            error_message = f"fin4u login failed: invalid credentials for {self.username}"
            logger.warning(error_message)
            raise InvalidCredentialsError(error_message)
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"fin4u login failed unexpectedly: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message) from e
        token = response.json().get("access_token")
        if not token:
            raise UnknownInternalError("fin4u token endpoint returned no access_token")
        logger.debug(f"fin4u login succeeded for user {self.username}")
        return token

    def _fetch_insurance_total(self, http: Session, token: str, api_version: str) -> float:
        response = http.get(
            f"{self.BASE_URL}/api/{api_version}/dashboard/insurance",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=15,
        )
        try:
            response.raise_for_status()
        except HTTPError as e:
            error_message = f"fin4u dashboard fetch failed: {e}"
            logger.error(error_message)
            raise UnknownInternalError(error_message) from e
        return float(response.json()["totalAssetValue"])

    @staticmethod
    def _encrypt_password(plain: str, public_key_pem: bytes) -> str:
        # OAEP hash and MGF1 hash are deliberately mismatched (SHA-256 + SHA-1)
        # — the SPA does the same; Keycloak rejects anything else.
        public_key = load_pem_public_key(public_key_pem)
        ciphertext = public_key.encrypt(  # type: ignore[union-attr]
            plaintext=plain.encode("utf-8"),
            padding=OAEP(mgf=MGF1(algorithm=SHA1()), algorithm=SHA256(), label=None),  # nosec B303
        )
        return base64.b64encode(ciphertext).decode("ascii")


class Fin4uHandler(BankHandler):
    CREDENTIAL_FIELDS = ("username", "password")

    @contextmanager
    def session(self) -> Iterator[_Fin4uSession]:
        yield _Fin4uSession(
            username=self.credentials["username"],
            password=self.credentials["password"],
        )
