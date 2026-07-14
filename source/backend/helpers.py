import functools
import hashlib
import pathlib
import tomllib
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from requests import HTTPError, Response, Session

from source.backend.constants import HTTP_TIMEOUT
from source.backend.exceptions import UnknownInternalError

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transactions.transaction import Transaction


class RestAPIClient:
    def __init__(self, name: str, base_url: str):
        self.name = name
        self.http = Session()
        self._base_url = base_url

    def request(
        self,
        method: str,
        path: str,
        json_body: dict | None = None,
        params: dict | None = None,
        data: dict | None = None,
    ) -> Response:
        return self.http.request(
            method=method,
            url=f"{self._base_url}{path}",
            json=json_body,
            data=data,
            params=params,
            timeout=HTTP_TIMEOUT.total_seconds(),
        )

    def get(self, path: str, params: dict | None = None) -> dict:
        return self._parse_json(response=self.request(method="GET", path=path, params=params), label=f"GET {path}")

    def post(self, path: str, json_body: dict | None = None) -> dict:
        return self._parse_json(
            response=self.request(method="POST", path=path, json_body=json_body), label=f"POST {path}"
        )

    def raise_for_status(self, response: Response, label: str) -> None:
        try:
            response.raise_for_status()
        except HTTPError as e:
            raise UnknownInternalError(f"{self.name} {label}: {e}: {response.text}") from e

    def _parse_json(self, response: Response, label: str) -> dict:
        self.raise_for_status(response=response, label=f"{label} failed")
        return response.json()


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def seconds_until_next_midnight() -> float:
    # The +5s margin ensures we run just AFTER midnight, so "today" has rolled over before anything date-dependent is
    # evaluated
    now = datetime.now()
    next_midnight = datetime.combine(date=now.date() + timedelta(days=1), time=time.min)
    return (next_midnight - now).total_seconds() + 5


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def apply_fields(entity: object, fields: dict) -> None:
    for key, value in fields.items():
        setattr(entity, key, value)


def get_key_of_transaction(transaction: "FetchedTransaction | Transaction") -> str:
    # Only use fields that cannot change
    return f"{transaction.date} {transaction.purpose} {transaction.other_party} {transaction.amount}"


def format_transaction_for_categorization(transaction: "FetchedTransaction | Transaction") -> str:
    id_insert = f"id={transaction.id}, " if getattr(transaction, "id", None) else ""
    return f"<{transaction.__class__.__name__}({id_insert}amount={transaction.amount}, purpose={transaction.purpose}, other_party={transaction.other_party}, transaction_type={transaction.transaction_type})>"


def epoch_ms_to_date(value: str | int) -> date:
    return datetime.fromtimestamp(timestamp=int(value) / 1000, tz=timezone.utc).date()


def format_amount(amount: float) -> str:
    formatted = f"{amount:,.2f}"
    formatted = formatted.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return f"{formatted} €"


def parse_german_decimal(value: str) -> float:
    # Some sources mix formats: amounts use a dot ("460.80"), share counts a German comma ("3,761").
    # Only when a comma is present do we treat dots as thousands separators.
    text = str(value)
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    return float(text)


def get_root_path_of_repository() -> Path:
    return pathlib.Path(__file__).parent.parent.parent


@functools.cache
def get_content_of_pyproject_toml() -> dict:
    pyproject_path = get_root_path_of_repository() / "pyproject.toml"
    with pyproject_path.open("rb") as handle:
        return tomllib.load(handle)


def get_project_name() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["name"]


def get_project_description() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["description"]


def get_project_version() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["version"]


def get_project_repository() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["repository"]


def _get_source_path() -> Path:
    return get_root_path_of_repository() / "source"


def get_backend_source_path() -> Path:
    return _get_source_path() / "backend"


def get_frontend_path() -> Path:
    return _get_source_path() / "frontend"


def get_frontend_source_path() -> Path:
    return get_frontend_path() / "src"
