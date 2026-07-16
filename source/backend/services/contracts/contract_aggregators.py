import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from source.backend.models.transactions.transaction_category import normalize_string

if TYPE_CHECKING:
    from collections.abc import Callable

    from source.backend.models.transactions.transaction import Transaction


@dataclass(frozen=True)
class Fingerprint:
    key: str
    display_name: str


_PAYPAL_MERCHANT_PATTERNS = (
    re.compile(r"ihr einkauf bei\s+(?P<merchant>[^,/]+)", flags=re.IGNORECASE),
    re.compile(r"/\s*\.?\s*(?P<merchant>[^,/]+?)\s*,", flags=re.IGNORECASE),
)

_KLARNA_MERCHANT_PATTERN = re.compile(r"purchase at\s+(?P<merchant>.+)", flags=re.IGNORECASE)


def _paypal_merchant(purpose: str) -> str | None:
    for pattern in _PAYPAL_MERCHANT_PATTERNS:
        match = pattern.search(purpose)
        if match:
            merchant = match.group("merchant").strip()
            if merchant:
                return merchant
    return None


def _klarna_merchant(purpose: str) -> str | None:
    match = _KLARNA_MERCHANT_PATTERN.search(purpose)
    if match:
        return match.group("merchant").strip() or None
    return None


# Payment intermediaries (e.g. PayPal, Klarna) whose own name hides the real merchant:
# name substring to match in the normalized other_party → merchant extractor for the purpose.
_AGGREGATORS: "tuple[tuple[str, Callable[[str], str | None]], ...]" = (
    ("paypal", _paypal_merchant),
    ("klarna", _klarna_merchant),
)


def compute_fingerprint(transaction: "Transaction") -> Fingerprint | None:
    other_party = (transaction.other_party or "").strip()
    if not other_party:
        return None

    normalized_party = normalize_string(other_party)
    for name, extract_merchant in _AGGREGATORS:
        if name in normalized_party:
            merchant = extract_merchant(transaction.purpose or "")
            if not merchant:
                return None
            return Fingerprint(key=f"{name}:{normalize_string(merchant)}", display_name=merchant)

    return Fingerprint(key=f"party:{normalize_string(other_party)}", display_name=other_party)
