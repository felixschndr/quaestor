import functools
import pathlib
import tomllib
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transaction import Transaction


def get_key_of_transaction(transaction: "FetchedTransaction | Transaction") -> str:
    # Only use fields that cannot change
    return f"{transaction.date} {transaction.purpose} {transaction.other_party} {transaction.amount}"


def format_transaction_for_categorization(transaction: "FetchedTransaction | Transaction") -> str:
    id_insert = f"id={transaction.id}, " if getattr(transaction, "id", None) else ""
    return f"<{transaction.__class__.__name__}({id_insert}amount={transaction.amount}, purpose={transaction.purpose}, other_party={transaction.other_party}, transaction_type={transaction.transaction_type})>"


def epoch_ms_to_date(value: str | int) -> date:
    return datetime.fromtimestamp(timestamp=int(value) / 1000, tz=timezone.utc).date()


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


def _get_source_path() -> Path:
    return get_root_path_of_repository() / "source"


def get_backend_source_path() -> Path:
    return _get_source_path() / "backend"


def get_frontend_source_path() -> Path:
    return _get_source_path() / "frontend"
