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
    TRAVEL = "TRAVEL"
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
    DEPOSIT = "DEPOSIT"
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

        haystacks = [normalize_string(str(field)) for field in (transaction.purpose, transaction.other_party) if field]
        for category, matchers in TRANSACTION_CATEGORY_MAPPING.items():
            for matcher in matchers:
                if any(matcher in haystack for haystack in haystacks):
                    return category

        logger.info(f"No category matched for {transaction.to_string_for_transaction_categorization()}")
        return cls.UNKNOWN


# Type-based categories take precedence over text matchers
CATEGORY_BY_TRANSACTION_TYPE: dict[TransactionType, TransactionCategory] = {
    # DEPOSIT stays mapped to SAVINGS: deposits are predominantly VL/savings-account
    # contributions (e.g. "AG-Beitrag laufend"). The standalone DEPOSIT category is
    # manual-only, mirroring TRANSFER.
    TransactionType.DEPOSIT: TransactionCategory.SAVINGS,
    TransactionType.REMOVAL: TransactionCategory.WITHDRAWAL,
}


TRANSACTION_CATEGORY_MAPPING: dict[TransactionCategory, list[str]] = {
    TransactionCategory.SALARY: ["lohn", "gehalt"],
    TransactionCategory.ALLOWANCE: ["taschengeld", "kindergeld"],
    TransactionCategory.PENSION: ["rente"],
    TransactionCategory.REIMBURSEMENT: ["reisespesen", "korrektur"],
    TransactionCategory.INTEREST: ["zinsen"],
    TransactionCategory.INVESTMENT: ["msci", "nasdaq", "(dist)", "(acc)"],
    TransactionCategory.SUBSCRIPTIONS: [
        "spotify",
        "ionos",
        "nabu casa",
        "apple com bill",
        "apple services",
        "itunes",
        "google workspace",
    ],
    TransactionCategory.RENT: ["miete"],
    TransactionCategory.UTILITIES: ["vattenfall", "vodafone", "rundfunk", "strom"],
    TransactionCategory.TRAVEL: ["vw leasing", "auto", "tuv", "tuev", "db", "bahn", "hotel"],
    TransactionCategory.FUEL: ["tankstelle", "aral station", "bft"],
    TransactionCategory.FITNESS: ["fit-in", "fitness"],
    TransactionCategory.SUPERMARKET: [
        "rewe",
        "billa",
        "aldi",
        "lidl",
        "edeka",
        "kaufland",
        "penny",
        "netto",
        "scheck-in",
        "lebensmittel",
        "kiosk",
        "euroshop",
    ],
    TransactionCategory.DRUGSTORE: ["drogerie", "rossmann", "mueller"],
    TransactionCategory.RESTAURANTS: [
        "doener",
        "pizzeria",
        "aramark",
        "eurest",
        "baecker",
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
        "restaurant",
        "thai",
        "gastro",
        "mcdonalds",
        "bowlwerk",
        "le crobag",
        "pommes",
        "kfc",
        "kabap",
        "cuisine",
        "bratar",
    ],
    TransactionCategory.PERSONAL_CARE: ["friseur", "barber", "waxing", "apotheke", "krankenkasse"],
    TransactionCategory.CLOTHING: ["new yorker", "bijou brigette"],
    TransactionCategory.GIFTS: ["blume 2000"],
    TransactionCategory.ENTERTAINMENT: ["steam games", "nintendo", "baedergesel", "nzb", "feier", "triviar"],
    TransactionCategory.FEES: [
        "gocardless",
        "bewohnerparkausweis",
        "deutsche post ag",
        "education",
        "hochschule",
        "university",
        "universitaet",
    ],
    TransactionCategory.SAVINGS: ["sparen", "einzahlung"],
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


def normalize_string(input_string: str) -> str:
    return (
        input_string.strip()
        .lower()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace(".", " ")
    )
