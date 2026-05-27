from enum import Enum
from typing import TYPE_CHECKING

from source.backend.logging_utils import get_logger
from source.backend.models.transaction_type import TransactionType

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transaction import Transaction

logger = get_logger(__name__)


class TransactionCategory(str, Enum):
    SALARY = "SALARY"
    ALLOWANCE = "ALLOWANCE"
    PENSION = "PENSION"
    REIMBURSEMENT = "REIMBURSEMENT"
    INTEREST = "INTEREST"
    INVESTMENT = "INVESTMENT"
    SUBSCRIPTIONS = "SUBSCRIPTIONS"
    RENT = "RENT"
    UTILITIES = "UTILITIES"
    CAR = "CAR"
    FUEL = "FUEL"
    FITNESS = "FITNESS"
    ONLINE_SHOPPING = "ONLINE_SHOPPING"
    SUPERMARKET = "SUPERMARKET"
    DRUGSTORE = "DRUGSTORE"
    RESTAURANTS = "RESTAURANTS"
    PERSONAL_CARE = "PERSONAL_CARE"
    CLOTHING = "CLOTHING"
    GIFTS = "GIFTS"
    ENTERTAINMENT = "ENTERTAINMENT"
    FEES = "FEES"
    SAVINGS = "SAVINGS"
    WITHDRAWAL = "WITHDRAWAL"
    # TRANSFER is reserved for the future cross-bank linking (e.g. an OUTGOING on account 1
    # to an INCOMING on account 2
    TRANSFER = "TRANSFER"
    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_transaction(
        cls: type["TransactionCategory"], transaction: "FetchedTransaction | Transaction"
    ) -> "TransactionCategory":
        if transaction.transaction_type is not None:
            type_based = CATEGORY_BY_TRANSACTION_TYPE.get(transaction.transaction_type)
            if type_based is not None:
                return type_based

        haystacks = [field for field in (transaction.purpose, transaction.other_party) if field]
        for category, matchers in TRANSACTION_TYPE_MAPPING.items():
            for matcher in matchers:
                needle = matcher.lower()
                if any(needle in haystack.lower() for haystack in haystacks):
                    return category

        logger.warning(f"No category matched for {transaction}")
        return cls.UNKNOWN


# Type-based categories take precedence over text matchers
CATEGORY_BY_TRANSACTION_TYPE: dict[TransactionType, TransactionCategory] = {
    TransactionType.DEPOSIT: TransactionCategory.SAVINGS,
    TransactionType.REMOVAL: TransactionCategory.WITHDRAWAL,
}


TRANSACTION_TYPE_MAPPING: dict[TransactionCategory, list[str]] = {
    TransactionCategory.SALARY: ["lohn", "gehalt"],
    TransactionCategory.ALLOWANCE: ["taschengeld", "kindergeld"],
    TransactionCategory.PENSION: ["rv.rente", "renten service"],
    TransactionCategory.REIMBURSEMENT: ["reisespesen"],
    TransactionCategory.INTEREST: ["zinsen"],
    TransactionCategory.INVESTMENT: ["msci", "nasdaq"],
    TransactionCategory.SUBSCRIPTIONS: [
        "spotify",
        "ionos",
        "nabu casa",
        "apple.com bill",
        "apple services",
        "itunes",
        "google workspace",
    ],
    TransactionCategory.RENT: ["miete"],
    TransactionCategory.UTILITIES: ["vattenfall", "vodafone", "rundfunk", "strom"],
    TransactionCategory.CAR: ["vw leasing", "auto", "tuv", "tuev", "tüv"],
    TransactionCategory.FUEL: ["tankstelle", "aral station", "bft"],
    TransactionCategory.FITNESS: ["fit-in", "fitnessclub", "fitnessstudio"],
    TransactionCategory.SUPERMARKET: [
        "rewe",
        "aldi",
        "lidl",
        "edeka",
        "kaufland",
        "penny",
        "netto",
        "scheck-in",
        "lebensmittel",
    ],
    TransactionCategory.DRUGSTORE: ["dm-drogerie", "dm drogerie", "rossmann", "müller"],
    TransactionCategory.RESTAURANTS: [
        "doener",
        "pizzeria",
        "aramark",
        "eurest",
        "baeckerei",
        "gaststaette",
        "sumup",
        "spc*",
        "traumkuh",
        "kofteci",
        "irodion",
        "oxford pub",
        "orient master",
        "hakade",
        "stoevchen",
        "asia kim",
        "cafe",
        "z10",
        "chinese",
    ],
    TransactionCategory.PERSONAL_CARE: ["friseur", "barber"],
    TransactionCategory.CLOTHING: ["new yorker"],
    TransactionCategory.GIFTS: ["blume 2000"],
    TransactionCategory.ENTERTAINMENT: ["steam games", "nintendo", "baedergesel", "nzb", "feier", "triviar"],
    TransactionCategory.FEES: ["gocardless", "bewohnerparkausweis", "deutsche post ag"],
    TransactionCategory.SAVINGS: ["sparen", "einzahlung"],
    # TRANSFER: no text matchers — assigned only by the future cross-bank linker.
    TransactionCategory.ONLINE_SHOPPING: [
        "amazon",
        "amzn",
        "ebay",
        "zalando",
        "otto",
        "etsy",
        "kleinanzeigen",
        "klarna",
        "apple store",
        "ikea",
        "paypal",
        "studidruck",
    ],
}
