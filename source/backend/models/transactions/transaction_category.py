from enum import Enum
from typing import TYPE_CHECKING

from source.backend.helpers import format_transaction_for_categorization
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transactions.transaction import Transaction

logger = get_logger(__name__)


class TransactionCategory(str, Enum):
    SALARY = "SALARY"
    ALLOWANCE = "ALLOWANCE"
    PENSION = "PENSION"
    SIDE_INCOME = "SIDE_INCOME"
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
        cls: type["TransactionCategory"], transaction: "FetchedTransaction | Transaction", log_result: bool = True
    ) -> "TransactionCategory":
        category = cls._match(transaction=transaction)
        if log_result:
            if category is cls.UNKNOWN:
                logger.info(f"No category matched for {format_transaction_for_categorization(transaction)}")
            else:
                logger.debug(f"Matched {format_transaction_for_categorization(transaction)} to {category.value}")
        return category

    @classmethod
    def _match(
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

        return cls.UNKNOWN


# Type-based categories take precedence over text matchers
CATEGORY_BY_TRANSACTION_TYPE: dict[TransactionType, TransactionCategory] = {
    TransactionType.DEPOSIT: TransactionCategory.SAVINGS,
    TransactionType.REMOVAL: TransactionCategory.WITHDRAWAL,
    TransactionType.BUY: TransactionCategory.INVESTMENT,
    TransactionType.SELL: TransactionCategory.INVESTMENT,
    TransactionType.DIVIDEND: TransactionCategory.INVESTMENT,
    TransactionType.SPINOFF: TransactionCategory.INVESTMENT,
    TransactionType.SPLIT: TransactionCategory.INVESTMENT,
    TransactionType.SWAP: TransactionCategory.INVESTMENT,
    TransactionType.TAX_REFUND: TransactionCategory.INVESTMENT,
}


TRANSACTION_CATEGORY_MAPPING: dict[TransactionCategory, list[str]] = {
    TransactionCategory.SALARY: ["lohn", "gehalt"],
    TransactionCategory.ALLOWANCE: ["taschengeld", "kindergeld"],
    TransactionCategory.PENSION: ["rente"],
    TransactionCategory.REIMBURSEMENT: ["reisespesen", "korrektur", "erstatt", "ruckzahlung"],
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
        "google cloud",
        "google ireland",
        "netflix",
        "serverprofis",
        "haufe service center gmbh",
    ],
    TransactionCategory.RENT: ["miete"],
    TransactionCategory.UTILITIES: ["vattenfall", "vodafone", "rundfunk", "strom"],
    TransactionCategory.TRAVEL: ["vw leasing", "audi", "auto", "tuv", "tuev", "db", "bahn", "hotel", "vbk", "urlaub"],
    TransactionCategory.FUEL: ["tankstelle", "aral station", "bft", "tanken", "esso"],
    TransactionCategory.FITNESS: ["fit-in", "fitness", "gym"],
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
        "go asia",
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
        "brauhaus",
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
        "the door",
        "la cage",
        "cinnamood",
    ],
    TransactionCategory.PERSONAL_CARE: ["friseur", "barber", "waxing", "apotheke", "krankenkasse", "zahnarzt"],
    TransactionCategory.CLOTHING: ["new yorker", "bijou brigette", "deichmann"],
    TransactionCategory.GIFTS: ["blume 2000", "geburtstag", "schenkung"],
    TransactionCategory.ENTERTAINMENT: [
        "steam games",
        "nintendo",
        "baedergesel",
        "nzb",
        "feier",
        "triviar",
        "fest",
        "sprungbude",
        "buchhandlung",
        "theater",
        "therme",
        "spiele pyramide",
    ],
    TransactionCategory.FEES: [
        "gocardless",
        "bewohnerparkausweis",
        "deutsche post ag",
        "education",
        "hochschule",
        "university",
        "universitaet",
        "abrechnung kontostand",
        "versicher",
        "anwalt",
        "kanzlei",
        "notar",
        "parken",
        "inkasso",
        "aktenzeichen",
        "kartensperre",
        "abschluss per",
        "steuer",
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
