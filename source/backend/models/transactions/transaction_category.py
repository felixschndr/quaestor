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
    _value_: str
    group: CategoryGroup | None

    def __new__(cls, value: str, group: CategoryGroup | None = None) -> "TransactionCategory":
        member = str.__new__(cls, value)  # noqa: FKA100
        member._value_ = value
        member.group = group
        return member

    SALARY = "SALARY", CategoryGroup.INCOME
    SIDE_INCOME = "SIDE_INCOME", CategoryGroup.INCOME
    PENSION = "PENSION", CategoryGroup.INCOME
    ALLOWANCE = "ALLOWANCE", CategoryGroup.INCOME
    PUBLIC_BENEFITS = "PUBLIC_BENEFITS", CategoryGroup.INCOME
    RENTAL_INCOME = "RENTAL_INCOME", CategoryGroup.INCOME
    INTEREST = "INTEREST", CategoryGroup.INCOME
    PRIVATE_SALES = "PRIVATE_SALES", CategoryGroup.INCOME
    REIMBURSEMENT = "REIMBURSEMENT", CategoryGroup.INCOME
    OTHER_INCOME = "OTHER_INCOME", CategoryGroup.INCOME

    SUPERMARKET = "SUPERMARKET", CategoryGroup.FOOD_AND_DRINK
    RESTAURANTS = "RESTAURANTS", CategoryGroup.FOOD_AND_DRINK
    FOOD_DELIVERY = "FOOD_DELIVERY", CategoryGroup.FOOD_AND_DRINK

    RENT = "RENT", CategoryGroup.HOUSING
    ELECTRICITY = "ELECTRICITY", CategoryGroup.HOUSING
    HEATING = "HEATING", CategoryGroup.HOUSING
    INTERNET_PHONE = "INTERNET_PHONE", CategoryGroup.HOUSING
    BROADCASTING_FEE = "BROADCASTING_FEE", CategoryGroup.HOUSING
    FURNISHING = "FURNISHING", CategoryGroup.HOUSING
    OTHER_HOUSING = "OTHER_HOUSING", CategoryGroup.HOUSING

    FUEL = "FUEL", CategoryGroup.MOBILITY
    PUBLIC_TRANSPORT = "PUBLIC_TRANSPORT", CategoryGroup.MOBILITY
    CAR = "CAR", CategoryGroup.MOBILITY
    PARKING = "PARKING", CategoryGroup.MOBILITY
    SHARING_TAXI = "SHARING_TAXI", CategoryGroup.MOBILITY
    OTHER_MOBILITY = "OTHER_MOBILITY", CategoryGroup.MOBILITY

    VACATION = "VACATION", CategoryGroup.LEISURE
    FITNESS = "FITNESS", CategoryGroup.LEISURE
    EVENTS = "EVENTS", CategoryGroup.LEISURE
    STREAMING = "STREAMING", CategoryGroup.LEISURE
    GAMING = "GAMING", CategoryGroup.LEISURE
    ENTERTAINMENT = "ENTERTAINMENT", CategoryGroup.LEISURE

    ONLINE_SHOPPING = "ONLINE_SHOPPING", CategoryGroup.SHOPPING
    CLOTHING = "CLOTHING", CategoryGroup.SHOPPING
    ELECTRONICS = "ELECTRONICS", CategoryGroup.SHOPPING
    SOFTWARE_CLOUD = "SOFTWARE_CLOUD", CategoryGroup.SHOPPING
    GIFTS = "GIFTS", CategoryGroup.SHOPPING

    DRUGSTORE = "DRUGSTORE", CategoryGroup.HEALTH
    PHARMACY = "PHARMACY", CategoryGroup.HEALTH
    DOCTOR = "DOCTOR", CategoryGroup.HEALTH
    PERSONAL_CARE = "PERSONAL_CARE", CategoryGroup.HEALTH

    HEALTH_INSURANCE = "HEALTH_INSURANCE", CategoryGroup.INSURANCE
    OTHER_INSURANCE = "OTHER_INSURANCE", CategoryGroup.INSURANCE

    BANK_FEES = "BANK_FEES", CategoryGroup.FINANCES
    TAXES = "TAXES", CategoryGroup.FINANCES
    LEGAL = "LEGAL", CategoryGroup.FINANCES
    EDUCATION = "EDUCATION", CategoryGroup.FINANCES
    DONATION = "DONATION", CategoryGroup.FINANCES
    FEES = "FEES", CategoryGroup.FINANCES

    SAVINGS = "SAVINGS", CategoryGroup.SAVINGS_AND_INVESTMENTS
    INVESTMENT = "INVESTMENT", CategoryGroup.SAVINGS_AND_INVESTMENTS

    CHILDCARE = "CHILDCARE", CategoryGroup.CHILDREN
    POCKET_MONEY = "POCKET_MONEY", CategoryGroup.CHILDREN
    OTHER_CHILDREN = "OTHER_CHILDREN", CategoryGroup.CHILDREN

    PET_SUPPLIES = "PET_SUPPLIES", CategoryGroup.PETS
    VET = "VET", CategoryGroup.PETS

    WITHDRAWAL = "WITHDRAWAL", CategoryGroup.MISCELLANEOUS
    DEPOSIT = "DEPOSIT", CategoryGroup.MISCELLANEOUS
    TRANSFER = "TRANSFER", CategoryGroup.MISCELLANEOUS
    CREDIT_CARD_SETTLEMENT = "CREDIT_CARD_SETTLEMENT", CategoryGroup.MISCELLANEOUS

    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_transaction(
        cls: type["TransactionCategory"],
        transaction: "FetchedTransaction | Transaction",
        rules: "CategorizationRules | None" = None,
        log_result: bool = True,
    ) -> str:
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
    user_rules: tuple[tuple[str, str], ...] = ()
    disabled_default_matchers: frozenset[str] = frozenset()
    custom_groups: Mapping[str, CategoryGroup] = field(default_factory=dict)


CATEGORIES_BY_GROUP: dict[CategoryGroup, tuple[TransactionCategory, ...]] = {
    group: tuple(category for category in TransactionCategory if category.group is group) for group in CategoryGroup
}

# Money can only come in for these groups, so their matchers ignore outgoing transactions
INCOMING_ONLY_GROUPS = frozenset({CategoryGroup.INCOME})


def group_of(category: str, custom_groups: Mapping[str, CategoryGroup] | None = None) -> CategoryGroup | None:
    if category in _CATEGORY_VALUES:
        return TransactionCategory(category).group
    return (custom_groups or {}).get(category)


def direction_allows(category: str, amount: float, custom_groups: Mapping[str, CategoryGroup] | None = None) -> bool:
    return amount > 0 or group_of(category=category, custom_groups=custom_groups) not in INCOMING_ONLY_GROUPS


def is_known_category(category: str, custom_groups: Mapping[str, CategoryGroup] | None = None) -> bool:
    return category in _CATEGORY_VALUES or category in (custom_groups or {})


def expand_category_selection(
    selection: Iterable[str], custom_groups: Mapping[str, CategoryGroup] | None = None
) -> list[str]:
    custom_groups = custom_groups or {}
    expanded: dict[str, None] = {}
    for item in selection:
        key = item.value if isinstance(item, Enum) else item
        if key in GROUP_VALUES:
            group = CategoryGroup(key)
            expanded.update(dict.fromkeys(category.value for category in CATEGORIES_BY_GROUP[group]))
            expanded.update(
                dict.fromkeys(custom for custom, custom_group in custom_groups.items() if custom_group == group)
            )
        elif is_known_category(category=key, custom_groups=custom_groups):
            expanded[key] = None
    return list(expanded)


GROUP_VALUES = frozenset(group.value for group in CategoryGroup)
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
        "ionos",
        "itunes",
    ],
    TransactionCategory.RENT: ["miete"],
    TransactionCategory.ELECTRICITY: ["strom", "vattenfall"],
    TransactionCategory.BROADCASTING_FEE: ["rundfunk"],
    TransactionCategory.INTERNET_PHONE: ["vodafone"],
    TransactionCategory.HEATING: ["fernwaerme", "heizoel"],
    TransactionCategory.FOOD_DELIVERY: ["lieferando", "uber eats", "wolt"],
    TransactionCategory.VACATION: [
        "airbnb",
        "holiday inn",
        "hotel",
        "lufthansa",
        "radisson",
        "tui",
        "urlaub",
    ],
    TransactionCategory.CAR: ["asfinag", "audi", "auto", "tuev", "tuv", "vw leasing"],
    TransactionCategory.PUBLIC_TRANSPORT: ["bahn", "db"],
    TransactionCategory.SHARING_TAXI: ["nextbike", "uber payments", "voi technology"],
    TransactionCategory.OTHER_MOBILITY: ["fahrrad"],
    TransactionCategory.FUEL: ["aral station", "bft", "esso", "ryd", "tanken", "tankstelle"],
    TransactionCategory.FITNESS: ["fitness", "gym"],
    TransactionCategory.SUPERMARKET: [
        "aldi",
        "billa",
        "edeka",
        "euroshop",
        "go asia",
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
    ],
    TransactionCategory.DRUGSTORE: ["drogerie", "mueller", "rossmann"],
    TransactionCategory.RESTAURANTS: [
        "allresto",
        "aramark",
        "backhau",
        "baecker",
        "brauhaus",
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
        "kabap",
        "kaffeeroester",
        "kfc",
        "le crobag",
        "mcdonalds",
        "pizzeria",
        "pommes",
        "restaurant",
        "schaenke",
        "sumup",
        "sushi",
        "thai",
        "wirtshaus",
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
        "buchhandlung",
        "feier",
        "patreon",
        "strand",
        "therme",
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
