import pathlib
from datetime import date, datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Union

if TYPE_CHECKING:
    # Imported only for type hints. Doing this at runtime would pull in
    # `bank_handlers/__init__.py` (which eagerly imports every handler) from a
    # module that several handlers themselves depend on → circular import.
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transaction import Transaction


def get_key_of_transaction(transaction: "Union[Transaction, FetchedTransaction]") -> str:
    return (
        f"{transaction.date} {transaction.purpose} {transaction.other_party} {transaction.amount} "
        f"{transaction.transaction_type}"
    )


def epoch_ms_to_date(value: str | int) -> date:
    return datetime.fromtimestamp(timestamp=int(value) / 1000, tz=timezone.utc).date()


def get_root_path_of_repository() -> Path:
    return pathlib.Path(__file__).parent.parent.parent


def _get_source_path() -> Path:
    return get_root_path_of_repository() / "source"


def get_backend_source_path() -> Path:
    return _get_source_path() / "backend"


def get_frontend_source_path() -> Path:
    return _get_source_path() / "frontend"
