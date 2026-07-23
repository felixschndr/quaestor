import functools
import hashlib
import tomllib
from datetime import date, datetime, time, timedelta, timezone
from email.utils import parseaddr
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transactions.transaction import Transaction


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


def index_transactions_for_matching(transactions: "Iterable[Transaction]") -> dict[str, "Transaction"]:
    # Each transaction is indexed under its bank reference (when the bank provides one) AND under its
    # field fingerprint, so a fetched transaction still matches when the bank omits the reference it
    # delivered on an earlier sync.
    index = {}
    for transaction in transactions:
        if transaction.bank_reference:
            index[transaction.bank_reference] = transaction
        index[get_key_of_transaction(transaction)] = transaction
    return index


def format_transaction_for_categorization(transaction: "FetchedTransaction | Transaction") -> str:
    id_insert = f"id={transaction.id}, " if getattr(transaction, "id", None) else ""
    return f"<{transaction.__class__.__name__}({id_insert}amount={transaction.amount}, purpose={transaction.purpose}, other_party={transaction.other_party}, transaction_type={transaction.transaction_type})>"


def epoch_ms_to_date(value: str | int) -> date:
    return datetime.fromtimestamp(timestamp=int(value) / 1000, tz=timezone.utc).date()


def format_amount(amount: float, currency: str = "EUR") -> str:
    from source.backend.services.core import i18n_service

    formatted = f"{amount:,.2f}"
    formatted = formatted.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return f"{formatted} {i18n_service.currency_symbol(currency)}"


def parse_german_decimal(value: str) -> float:
    text = str(value)
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    return float(text)


def get_root_path_of_repository() -> Path:
    return Path(__file__).parent.parent.parent


def get_pyproject_toml_path() -> Path:
    return get_root_path_of_repository() / "pyproject.toml"


@functools.cache
def get_content_of_pyproject_toml() -> dict:
    with get_pyproject_toml_path().open("rb") as handle:
        return tomllib.load(handle)


def get_project_name() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["name"]


def get_project_description() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["description"]


def get_project_version() -> str:
    return get_content_of_pyproject_toml()["tool"]["poetry"]["version"]


def get_project_author_emails() -> list[str]:
    authors = get_content_of_pyproject_toml()["tool"]["poetry"]["authors"]
    return [email for _, email in (parseaddr(author) for author in authors) if email]


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
