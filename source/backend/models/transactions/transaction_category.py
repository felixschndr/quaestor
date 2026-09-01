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
        if getattr(transaction, "is_refund", False):
            return cls.REIMBURSEMENT

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
    TransactionCategory.SALARY: ["gehalt", "lohn"],
    TransactionCategory.ALLOWANCE: ["kindergeld", "taschengeld"],
    TransactionCategory.PENSION: ["rente"],
    TransactionCategory.REIMBURSEMENT: ["erstatt", "korrektur", "reisespesen", "ruckzahlung"],
    TransactionCategory.INTEREST: ["interest applied", "zinsen", "zinsgutschrift"],
    TransactionCategory.INVESTMENT: [
        "(acc)",
        "(dist)",
        "invest",
        "msci",
        "nasdaq",
        "scalable capital",
        "trade republic",
    ],
    TransactionCategory.SUBSCRIPTIONS: [
        "anthropic",
        "apple com bill",
        "apple services",
        "google cloud",
        "google ireland",
        "google workspace",
        "haufe service center gmbh",
        "hosting vault",
        "ionos",
        "itunes",
        "nabu casa",
        "netflix",
        "patreon",
        "serverprofis",
        "spotify",
        "youtube",
    ],
    TransactionCategory.RENT: ["miete"],
    TransactionCategory.UTILITIES: ["rundfunk", "strom", "vattenfall", "vodafone"],
    TransactionCategory.TRAVEL: [
        "airbnb",
        "airplus",
        "asfinag",
        "audi",
        "auto",
        "bahn",
        "db",
        "fahrrad",
        "frankf airport",
        "hotel",
        "maseven",
        "nextbike",
        "radisson",
        "sic rhein",
        "tuev",
        "tui",
        "tuv",
        "uber payments",
        "upland parcs",
        "urlaub",
        "vbk",
        "voi technology",
        "vw leasing",
    ],
    TransactionCategory.FUEL: ["aral station", "bft", "esso", "ryd", "tanken", "tankstelle", "turmoel"],
    TransactionCategory.FITNESS: ["fit-in", "fitness", "gym"],
    TransactionCategory.SUPERMARKET: [
        "aktiv markt",
        "aldi",
        "billa",
        "edeka",
        "euroshop",
        "go asia",
        "joerg geiger",
        "kaufland",
        "kiosk",
        "knuspr",
        "lebensmittel",
        "lidl",
        "netto",
        "penny",
        "picnic",
        "rewe",
        "scheck-in",
        "teegschwendner",
        "teeretail",
    ],
    TransactionCategory.DRUGSTORE: ["drogerie", "mueller", "rossmann"],
    TransactionCategory.RESTAURANTS: [
        "allresto",
        "aramark",
        "asia kim",
        "backhau",
        "baecker",
        "bier konig",
        "bowlwerk",
        "bratar",
        "brauhaus",
        "brotha",
        "burger",
        "cafe",
        "chinese",
        "cinnamood",
        "cuisine",
        "doener",
        "eurest",
        "gastro",
        "gaststaette",
        "hakade",
        "irodion",
        "kabap",
        "kaffeeroester",
        "kfc",
        "kofteci",
        "la cage",
        "le crobag",
        "mcdonalds",
        "neon karls",
        "orient master",
        "oxford pub",
        "pizzeria",
        "pommes",
        "restaurant",
        "schaenke",
        "stoevchen",
        "studio 83",
        "sumup",
        "thai",
        "the door",
        "traumkuh",
        "wirtshaus",
        "z10",
    ],
    TransactionCategory.PERSONAL_CARE: [
        "apotheke",
        "barber",
        "friseur",
        "krankenkasse",
        "rituals",
        "waxing",
        "zahnarzt",
    ],
    TransactionCategory.CLOTHING: ["bijou brigitte", "deichmann", "jack jones", "new yorker"],
    TransactionCategory.GIFTS: ["blume 2000", "geburtstag", "geschenk", "gutschein", "schenkung"],
    TransactionCategory.ENTERTAINMENT: [
        "ausgehen",
        "baedergesel",
        "buchhandlung",
        "eventim",
        "feier",
        "fest",
        "g2a com",
        "nintendo",
        "nzb",
        "spiele pyramide",
        "sprungbude",
        "steam games",
        "steampowered",
        "strand",
        "theater",
        "therme",
        "triviar",
    ],
    TransactionCategory.FEES: [
        "abrechnung kontostand",
        "abschluss per",
        "aktenzeichen",
        "anwalt",
        "bewohnerparkausweis",
        "deutsche post ag",
        "education",
        "gerichtskasse",
        "gocardless",
        "hochschule",
        "inkasso",
        "kanzlei",
        "kartensperre",
        "krankenvers",
        "notar",
        "parken",
        "parkgarage",
        "steuer",
        "universitaet",
        "university",
        "versicher",
    ],
    TransactionCategory.SAVINGS: ["einzahlung", "sparen"],
    TransactionCategory.ONLINE_SHOPPING: [
        "aliexpress",
        "amazon",
        "amzn",
        "apple store",
        "caseking",
        "ebay",
        "etsy",
        "ikea",
        "klarna",
        "kleinanzeigen",
        "koro",
        "otto",
        "paypal",
        "studidruck",
        "zalando",
    ],
    TransactionCategory.TRANSFER: ["umbuchung", "umgebucht"],
}


def normalize_string(input_string: str) -> str:
    normalized = (
        input_string.strip()
        .lower()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace(".", " ")
        .replace("/", " ")
    )
    return " ".join(normalized.split())
