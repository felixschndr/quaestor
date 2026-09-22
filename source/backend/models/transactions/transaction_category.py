from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

from source.backend.helpers import format_transaction_for_categorization
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction_type import TransactionType

if TYPE_CHECKING:
    from source.backend.bank_handlers.base import FetchedTransaction
    from source.backend.models.transactions.transaction import Transaction

logger = get_logger(__name__)


class CategoryGroup(str, Enum):
    # Declaration order is the display order
    INCOME = "INCOME"
    FOOD_AND_DRINK = "FOOD_AND_DRINK"
    HOUSING = "HOUSING"
    MOBILITY = "MOBILITY"
    LEISURE = "LEISURE"
    SHOPPING = "SHOPPING"
    HEALTH = "HEALTH"
    INSURANCE = "INSURANCE"
    FINANCES = "FINANCES"
    SAVINGS_AND_INVESTMENTS = "SAVINGS_AND_INVESTMENTS"
    CHILDREN = "CHILDREN"
    PETS = "PETS"
    MISCELLANEOUS = "MISCELLANEOUS"


class TransactionCategory(str, Enum):
    # Declaration order is the display order within a group
    SALARY = "SALARY"
    SIDE_INCOME = "SIDE_INCOME"
    PENSION = "PENSION"
    ALLOWANCE = "ALLOWANCE"
    PUBLIC_BENEFITS = "PUBLIC_BENEFITS"
    RENTAL_INCOME = "RENTAL_INCOME"
    INTEREST = "INTEREST"
    PRIVATE_SALES = "PRIVATE_SALES"
    REIMBURSEMENT = "REIMBURSEMENT"
    OTHER_INCOME = "OTHER_INCOME"

    SUPERMARKET = "SUPERMARKET"
    RESTAURANTS = "RESTAURANTS"
    FOOD_DELIVERY = "FOOD_DELIVERY"

    RENT = "RENT"
    ELECTRICITY = "ELECTRICITY"
    HEATING = "HEATING"
    INTERNET_PHONE = "INTERNET_PHONE"
    BROADCASTING_FEE = "BROADCASTING_FEE"
    FURNISHING = "FURNISHING"
    OTHER_HOUSING = "OTHER_HOUSING"

    FUEL = "FUEL"
    PUBLIC_TRANSPORT = "PUBLIC_TRANSPORT"
    CAR = "CAR"
    PARKING = "PARKING"
    SHARING_TAXI = "SHARING_TAXI"
    OTHER_MOBILITY = "OTHER_MOBILITY"

    VACATION = "VACATION"
    FITNESS = "FITNESS"
    EVENTS = "EVENTS"
    STREAMING = "STREAMING"
    GAMING = "GAMING"
    ENTERTAINMENT = "ENTERTAINMENT"

    ONLINE_SHOPPING = "ONLINE_SHOPPING"
    CLOTHING = "CLOTHING"
    ELECTRONICS = "ELECTRONICS"
    SOFTWARE_CLOUD = "SOFTWARE_CLOUD"
    GIFTS = "GIFTS"

    DRUGSTORE = "DRUGSTORE"
    PHARMACY = "PHARMACY"
    DOCTOR = "DOCTOR"
    PERSONAL_CARE = "PERSONAL_CARE"

    HEALTH_INSURANCE = "HEALTH_INSURANCE"
    OTHER_INSURANCE = "OTHER_INSURANCE"

    BANK_FEES = "BANK_FEES"
    TAXES = "TAXES"
    LEGAL = "LEGAL"
    EDUCATION = "EDUCATION"
    DONATION = "DONATION"
    FEES = "FEES"

    SAVINGS = "SAVINGS"
    INVESTMENT = "INVESTMENT"

    CHILDCARE = "CHILDCARE"
    POCKET_MONEY = "POCKET_MONEY"
    OTHER_CHILDREN = "OTHER_CHILDREN"

    PET_SUPPLIES = "PET_SUPPLIES"
    VET = "VET"

    WITHDRAWAL = "WITHDRAWAL"
    DEPOSIT = "DEPOSIT"
    TRANSFER = "TRANSFER"
    CREDIT_CARD_SETTLEMENT = "CREDIT_CARD_SETTLEMENT"

    UNKNOWN = "UNKNOWN"

    @property
    def group(self) -> CategoryGroup | None:
        return CATEGORY_GROUP.get(self)

    @classmethod
    def from_transaction(
        cls: type["TransactionCategory"],
        transaction: "FetchedTransaction | Transaction",
        rules: "CategorizationRules | None" = None,
        log_result: bool = True,
    ) -> str:
        # A category key: a member of this enum, or the key of a user's custom category their rule assigns
        matched = cls._match(transaction=transaction, rules=rules or CategorizationRules())
        category = matched.value if isinstance(matched, TransactionCategory) else matched
        if log_result:
            if category == cls.UNKNOWN:
                logger.info(f"No category matched for {format_transaction_for_categorization(transaction)}")
            else:
                logger.debug(f"Matched {format_transaction_for_categorization(transaction)} to {category}")
        return category

    @classmethod
    def _match(
        cls: type["TransactionCategory"], transaction: "FetchedTransaction | Transaction", rules: "CategorizationRules"
    ) -> str:
        if getattr(transaction, "is_refund", False):
            return cls.REIMBURSEMENT

        haystacks = [normalize_string(str(field)) for field in (transaction.purpose, transaction.other_party) if field]

        # A rule the user set up beats everything but a refund the bank flagged
        for pattern, category in rules.user_rules:
            if direction_allows(
                category=category, amount=transaction.amount, custom_groups=rules.custom_groups
            ) and any(pattern in haystack for haystack in haystacks):
                return category

        # Transfer detection overwrites the type of a linked leg, so match on the type the bank reported
        transaction_type = getattr(transaction, "transfer_original_type", None) or transaction.transaction_type
        if transaction_type is not None:
            type_based = CATEGORY_BY_TRANSACTION_TYPE.get(transaction_type)
            if type_based is not None:
                return type_based

        for category, matchers in TRANSACTION_CATEGORY_MAPPING.items():
            if not direction_allows(category=category, amount=transaction.amount):
                continue
            for matcher in matchers:
                if matcher not in rules.disabled_default_matchers and any(
                    matcher in haystack for haystack in haystacks
                ):
                    return category

        return cls.UNKNOWN


@dataclass(frozen=True)
class CategorizationRules:
    # A user's own (pattern, category key) rules, highest priority first
    user_rules: tuple[tuple[str, str], ...] = ()
    disabled_default_matchers: frozenset[str] = frozenset()
    # The group of each of the user's custom categories
    custom_groups: Mapping[str, CategoryGroup] = field(default_factory=dict)


CATEGORIES_BY_GROUP: dict[CategoryGroup, tuple[TransactionCategory, ...]] = {
    CategoryGroup.INCOME: (
        TransactionCategory.SALARY,
        TransactionCategory.SIDE_INCOME,
        TransactionCategory.PENSION,
        TransactionCategory.ALLOWANCE,
        TransactionCategory.PUBLIC_BENEFITS,
        TransactionCategory.RENTAL_INCOME,
        TransactionCategory.INTEREST,
        TransactionCategory.PRIVATE_SALES,
        TransactionCategory.REIMBURSEMENT,
        TransactionCategory.OTHER_INCOME,
    ),
    CategoryGroup.FOOD_AND_DRINK: (
        TransactionCategory.SUPERMARKET,
        TransactionCategory.RESTAURANTS,
        TransactionCategory.FOOD_DELIVERY,
    ),
    CategoryGroup.HOUSING: (
        TransactionCategory.RENT,
        TransactionCategory.ELECTRICITY,
        TransactionCategory.HEATING,
        TransactionCategory.INTERNET_PHONE,
        TransactionCategory.BROADCASTING_FEE,
        TransactionCategory.FURNISHING,
        TransactionCategory.OTHER_HOUSING,
    ),
    CategoryGroup.MOBILITY: (
        TransactionCategory.FUEL,
        TransactionCategory.PUBLIC_TRANSPORT,
        TransactionCategory.CAR,
        TransactionCategory.PARKING,
        TransactionCategory.SHARING_TAXI,
        TransactionCategory.OTHER_MOBILITY,
    ),
    CategoryGroup.LEISURE: (
        TransactionCategory.VACATION,
        TransactionCategory.FITNESS,
        TransactionCategory.EVENTS,
        TransactionCategory.STREAMING,
        TransactionCategory.GAMING,
        TransactionCategory.ENTERTAINMENT,
    ),
    CategoryGroup.SHOPPING: (
        TransactionCategory.ONLINE_SHOPPING,
        TransactionCategory.CLOTHING,
        TransactionCategory.ELECTRONICS,
        TransactionCategory.SOFTWARE_CLOUD,
        TransactionCategory.GIFTS,
    ),
    CategoryGroup.HEALTH: (
        TransactionCategory.DRUGSTORE,
        TransactionCategory.PHARMACY,
        TransactionCategory.DOCTOR,
        TransactionCategory.PERSONAL_CARE,
    ),
    CategoryGroup.INSURANCE: (
        TransactionCategory.HEALTH_INSURANCE,
        TransactionCategory.OTHER_INSURANCE,
    ),
    CategoryGroup.FINANCES: (
        TransactionCategory.BANK_FEES,
        TransactionCategory.TAXES,
        TransactionCategory.LEGAL,
        TransactionCategory.EDUCATION,
        TransactionCategory.DONATION,
        TransactionCategory.FEES,
    ),
    CategoryGroup.SAVINGS_AND_INVESTMENTS: (
        TransactionCategory.SAVINGS,
        TransactionCategory.INVESTMENT,
    ),
    CategoryGroup.CHILDREN: (
        TransactionCategory.CHILDCARE,
        TransactionCategory.POCKET_MONEY,
        TransactionCategory.OTHER_CHILDREN,
    ),
    CategoryGroup.PETS: (
        TransactionCategory.PET_SUPPLIES,
        TransactionCategory.VET,
    ),
    CategoryGroup.MISCELLANEOUS: (
        TransactionCategory.WITHDRAWAL,
        TransactionCategory.DEPOSIT,
        TransactionCategory.TRANSFER,
        TransactionCategory.CREDIT_CARD_SETTLEMENT,
    ),
}

CATEGORY_GROUP: dict[TransactionCategory, CategoryGroup] = {
    category: group for group, categories in CATEGORIES_BY_GROUP.items() for category in categories
}

# Money can only come in for these groups, so their matchers ignore outgoing transactions
INCOMING_ONLY_GROUPS = frozenset({CategoryGroup.INCOME})


def group_of(category: str, custom_groups: Mapping[str, CategoryGroup] | None = None) -> CategoryGroup | None:
    if category in _CATEGORY_VALUES:
        return CATEGORY_GROUP.get(TransactionCategory(category))
    return (custom_groups or {}).get(category)


def direction_allows(category: str, amount: float, custom_groups: Mapping[str, CategoryGroup] | None = None) -> bool:
    return amount > 0 or group_of(category=category, custom_groups=custom_groups) not in INCOMING_ONLY_GROUPS


def is_known_category(category: str, custom_groups: Mapping[str, CategoryGroup] | None = None) -> bool:
    return category in _CATEGORY_VALUES or category in (custom_groups or {})


def expand_category_selection(
    selection: Iterable[str], custom_groups: Mapping[str, CategoryGroup] | None = None
) -> list[str]:
    # A selected group stands for all of its categories, including custom ones; keys nobody knows are dropped
    custom_groups = custom_groups or {}
    expanded: dict[str, None] = {}
    for item in selection:
        key = item.value if isinstance(item, Enum) else item
        if key in _GROUP_VALUES:
            group = CategoryGroup(key)
            expanded.update(dict.fromkeys(category.value for category in CATEGORIES_BY_GROUP[group]))
            expanded.update(
                dict.fromkeys(custom for custom, custom_group in custom_groups.items() if custom_group == group)
            )
        elif is_known_category(category=key, custom_groups=custom_groups):
            expanded[key] = None
    return list(expanded)


_GROUP_VALUES = frozenset(group.value for group in CategoryGroup)
_CATEGORY_VALUES = frozenset(category.value for category in TransactionCategory)


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


# The first matching entry wins, so the order is the priority (independent of the display order). Catch-all payment
# intermediaries like PayPal or Amazon come last. A matcher may appear twice only when its first category is
# incoming-only: incoming goes to the first, outgoing falls through to the second.
TRANSACTION_CATEGORY_MAPPING: dict[TransactionCategory, list[str]] = {
    TransactionCategory.SALARY: ["gehalt", "lohn"],
    TransactionCategory.ALLOWANCE: ["kindergeld", "taschengeld"],
    TransactionCategory.PENSION: ["rente"],
    TransactionCategory.PUBLIC_BENEFITS: ["bafoeg", "bundesagentur", "elterngeld", "jobcenter"],
    TransactionCategory.REIMBURSEMENT: ["erstatt", "korrektur", "reisespesen", "ruckzahlung", "rueckzahlung"],
    TransactionCategory.INTEREST: ["interest applied", "zinsen", "zinsgutschrift"],
    TransactionCategory.PRIVATE_SALES: ["ebay", "kleinanzeigen", "rebuy", "vinted"],
    TransactionCategory.RENTAL_INCOME: ["miete"],
    TransactionCategory.INVESTMENT: [
        "(acc)",
        "(dist)",
        "invest",
        "msci",
        "nasdaq",
        "scalable capital",
        "trade republic",
    ],
    TransactionCategory.STREAMING: ["audible", "dazn", "disney plus", "netflix", "spotify", "youtube"],
    TransactionCategory.SOFTWARE_CLOUD: [
        "anthropic",
        "apple com bill",
        "apple services",
        "claude",
        "google cloud",
        "google ireland",
        "google workspace",
        "haufe service center gmbh",
        "hosting vault",
        "ionos",
        "itunes",
        "nabu casa",
        "serverprofis",
    ],
    TransactionCategory.RENT: ["miete"],
    TransactionCategory.ELECTRICITY: ["strom", "vattenfall"],
    TransactionCategory.BROADCASTING_FEE: ["rundfunk"],
    TransactionCategory.INTERNET_PHONE: ["vodafone"],
    TransactionCategory.HEATING: ["fernwaerme", "heizoel"],
    TransactionCategory.FOOD_DELIVERY: ["lieferando", "uber eats", "wolt"],
    TransactionCategory.VACATION: [
        "airbnb",
        "airplus",
        "frankf airport",
        "holiday inn",
        "hotel",
        "lufthansa",
        "maseven",
        "radisson",
        "tui",
        "upland parcs",
        "urlaub",
    ],
    TransactionCategory.CAR: ["asfinag", "audi", "auto", "tuev", "tuv", "vw leasing"],
    TransactionCategory.PUBLIC_TRANSPORT: ["bahn", "db", "vbk"],
    TransactionCategory.SHARING_TAXI: ["nextbike", "uber payments", "voi technology"],
    TransactionCategory.OTHER_MOBILITY: ["fahrrad", "sic rhein"],
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
        "supermarket",
        "supermarkt",
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
        "grill",
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
        "sushi",
        "thai",
        "the door",
        "traumkuh",
        "wirtshaus",
        "z10",
    ],
    TransactionCategory.VET: ["tierarzt", "tierklinik"],
    TransactionCategory.PET_SUPPLIES: ["fressnapf", "zooplus"],
    TransactionCategory.PHARMACY: ["apotheke"],
    TransactionCategory.DOCTOR: ["zahnarzt"],
    TransactionCategory.HEALTH_INSURANCE: ["krankenkasse", "krankenvers"],
    TransactionCategory.PERSONAL_CARE: ["barber", "friseur", "rituals", "waxing"],
    TransactionCategory.CLOTHING: ["bijou brigitte", "deichmann", "jack jones", "new yorker", "zalando"],
    TransactionCategory.GIFTS: ["blume 2000", "geburtstag", "geschenk", "gutschein", "schenkung"],
    TransactionCategory.EVENTS: ["eventim", "fest", "theater"],
    TransactionCategory.GAMING: ["g2a com", "nintendo", "spiele pyramide", "steam games", "steampowered"],
    TransactionCategory.ENTERTAINMENT: [
        "ausgehen",
        "baedergesel",
        "buchhandlung",
        "feier",
        "nzb",
        "patreon",
        "sprungbude",
        "strand",
        "therme",
        "triviar",
    ],
    TransactionCategory.BANK_FEES: ["abrechnung kontostand", "abschluss per", "kartensperre", "zinsen"],
    TransactionCategory.TAXES: ["finanzamt", "steuer"],
    TransactionCategory.LEGAL: ["aktenzeichen", "anwalt", "gerichtskasse", "inkasso", "kanzlei", "notar"],
    TransactionCategory.EDUCATION: ["education", "hochschule", "universitaet", "university"],
    TransactionCategory.PARKING: ["bewohnerparkausweis", "parken", "parkgarage"],
    TransactionCategory.OTHER_INSURANCE: ["versicher"],
    TransactionCategory.DONATION: ["spende"],
    TransactionCategory.FEES: ["deutsche post ag", "gocardless"],
    TransactionCategory.SAVINGS: ["einzahlung", "sparen"],
    TransactionCategory.CHILDCARE: ["kindergarten", "kita"],
    TransactionCategory.POCKET_MONEY: ["taschengeld"],
    TransactionCategory.ELECTRONICS: ["apple store", "caseking"],
    TransactionCategory.FURNISHING: ["ikea"],
    TransactionCategory.ONLINE_SHOPPING: [
        "aliexpress",
        "amazon",
        "amzn",
        "ebay",
        "etsy",
        "klarna",
        "kleinanzeigen",
        "koro",
        "otto",
        "paypal",
        "studidruck",
    ],
    TransactionCategory.CREDIT_CARD_SETTLEMENT: ["kreditkartenabrechnung"],
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
