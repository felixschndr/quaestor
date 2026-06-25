import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING

from source.backend.models.transaction_category import normalize_string

if TYPE_CHECKING:
    from source.backend.models.transaction import Transaction


@dataclass(frozen=True)
class Fingerprint:
    key: str
    display_name: str


class Aggregator(ABC):
    # A payment intermediary (e.g., PayPal, Klarna, ...) whose own name hides the real merchant.
    name: str

    @abstractmethod
    def matches(self, other_party: str | None) -> bool: ...

    @abstractmethod
    def extract_merchant(self, purpose: str) -> str | None: ...


class PayPalAggregator(Aggregator):
    name = "paypal"

    _MERCHANT_PATTERNS = (
        re.compile(r"ihr einkauf bei\s+(?P<merchant>[^,/]+)", flags=re.IGNORECASE),
        re.compile(r"/\s*\.?\s*(?P<merchant>[^,/]+?)\s*,", flags=re.IGNORECASE),
    )

    def matches(self, other_party: str | None) -> bool:
        return other_party is not None and "paypal" in normalize_string(other_party)

    def extract_merchant(self, purpose: str) -> str | None:
        for pattern in self._MERCHANT_PATTERNS:
            match = pattern.search(purpose)
            if match:
                merchant = match.group("merchant").strip()
                if merchant:
                    return merchant
        return None


AGGREGATORS: tuple[Aggregator, ...] = (PayPalAggregator(),)


def compute_fingerprint(transaction: "Transaction") -> Fingerprint | None:
    for aggregator in AGGREGATORS:
        if aggregator.matches(transaction.other_party):
            merchant = aggregator.extract_merchant(transaction.purpose or "")
            if not merchant:
                return None
            return Fingerprint(key=f"{aggregator.name}:{normalize_string(merchant)}", display_name=merchant)

    other_party = (transaction.other_party or "").strip()
    if not other_party:
        return None
    return Fingerprint(key=f"party:{normalize_string(other_party)}", display_name=other_party)
