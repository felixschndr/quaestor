import functools
import hashlib
import pathlib
import tomllib
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transaction import Transaction


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    return f"{amount:.2f} €"


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
