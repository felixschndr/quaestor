from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction


class TransactionCategory(str, Enum):
    ONLINE_SHOPPING = "ONLINE_SHOPPING"
    DRUGSTORE = "DRUGSTORE"
    SUPERMARKET = "SUPERMARKET"
    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_transaction(cls: type["TransactionCategory"], transaction: "FetchedTransaction") -> "TransactionCategory":
        haystacks = [field for field in (transaction.other_party, transaction.purpose) if field]
        for category, matchers in TRANSACTION_TYPE_MAPPING.items():
            for matcher in matchers:
                needle = matcher.lower()
                if any(needle in haystack.lower() for haystack in haystacks):
                    return category
        return cls.UNKNOWN


TRANSACTION_TYPE_MAPPING: dict[TransactionCategory, list[str]] = {
    TransactionCategory.ONLINE_SHOPPING: ["amazon", "ebay", "zalando", "otto", "etsy"],
    TransactionCategory.DRUGSTORE: ["dm-drogerie", "dm drogerie", "rossmann", "müller"],
    TransactionCategory.SUPERMARKET: ["rewe", "aldi", "lidl", "edeka", "kaufland", "penny", "netto"],
}
