"""Record where a transaction's category came from (matchers, user, contract, system)

Existing rows are classified by replaying the matchers as they were at this revision: a category the matchers
reproduce was automatic, anything else was set by the user, a contract or the system.

Revision ID: 0070
Revises: 0069
Create Date: 2026-09-15 12:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0070"
down_revision: Union[str, None] = "0069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of the categorization at this revision; the live code keeps evolving
_TYPE_CATEGORIES = {
    "DEPOSIT": "SAVINGS",
    "REMOVAL": "WITHDRAWAL",
    "BUY": "INVESTMENT",
    "SELL": "INVESTMENT",
    "DIVIDEND": "INVESTMENT",
    "SPINOFF": "INVESTMENT",
    "SPLIT": "INVESTMENT",
    "SWAP": "INVESTMENT",
    "TAX_REFUND": "INVESTMENT",
}
_MATCHERS = (
    ("SALARY", ("gehalt", "lohn")),
    ("ALLOWANCE", ("kindergeld", "taschengeld")),
    ("PENSION", ("rente",)),
    ("REIMBURSEMENT", ("erstatt", "korrektur", "reisespesen", "ruckzahlung")),
    ("INTEREST", ("interest applied", "zinsen", "zinsgutschrift")),
    ("INVESTMENT", ("(acc)", "(dist)", "invest", "msci", "nasdaq", "scalable capital", "trade republic")),
    (
        "SUBSCRIPTIONS",
        (
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
        ),
    ),
    ("RENT", ("miete",)),
    ("UTILITIES", ("rundfunk", "strom", "vattenfall", "vodafone")),
    (
        "TRAVEL",
        (
            "airbnb",
            "airplus",
            "asfinag",
            "audi",
            "auto",
            "bahn",
            "db",
            "fahrrad",
            "frankf airport",
            "holiday inn",
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
        ),
    ),
    ("FUEL", ("aral station", "bft", "esso", "ryd", "tanken", "tankstelle", "turmoel")),
    ("FITNESS", ("fit-in", "fitness", "gym")),
    (
        "SUPERMARKET",
        (
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
        ),
    ),
    ("DRUGSTORE", ("drogerie", "mueller", "rossmann")),
    (
        "RESTAURANTS",
        (
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
        ),
    ),
    ("PERSONAL_CARE", ("apotheke", "barber", "friseur", "krankenkasse", "rituals", "waxing", "zahnarzt")),
    ("CLOTHING", ("bijou brigitte", "deichmann", "jack jones", "new yorker")),
    ("GIFTS", ("blume 2000", "geburtstag", "geschenk", "gutschein", "schenkung")),
    (
        "ENTERTAINMENT",
        (
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
        ),
    ),
    (
        "FEES",
        (
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
        ),
    ),
    ("SAVINGS", ("einzahlung", "sparen")),
    (
        "ONLINE_SHOPPING",
        (
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
        ),
    ),
    ("TRANSFER", ("umbuchung", "umgebucht")),
)


def _normalize(value: str) -> str:
    normalized = (
        value.strip()
        .lower()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace(".", " ")
        .replace("/", " ")
    )
    return " ".join(normalized.split())


def _replay(purpose: str | None, other_party: str | None, transaction_type: str | None) -> str:
    if transaction_type in _TYPE_CATEGORIES:
        return _TYPE_CATEGORIES[transaction_type]
    haystacks = [_normalize(field) for field in (purpose, other_party) if field]
    for category, matchers in _MATCHERS:
        if any(matcher in haystack for matcher in matchers for haystack in haystacks):
            return category
    return "UNKNOWN"


def _classify(row: sa.Row) -> str:
    if row.category == "UNKNOWN":
        return "AUTO"
    if row.contract_id is not None and row.category == row.contract_category:
        return "CONTRACT"
    replayed = _replay(
        purpose=row.purpose,
        other_party=row.other_party,
        transaction_type=row.transfer_original_type or row.transaction_type,
    )
    if replayed == row.category:
        return "AUTO"
    # Bank-flagged refunds and detected reversals cannot be replayed
    if row.category == "REIMBURSEMENT":
        return "SYSTEM"
    return "MANUAL"


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "category_source",
            sa.Enum("AUTO", "MANUAL", "CONTRACT", "SYSTEM", name="categorysource"),
            nullable=False,
            server_default="AUTO",
        ),
    )
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT transactions.id, transactions.purpose, transactions.other_party, transactions.transaction_type, "
            "transactions.transfer_original_type, transactions.category, transactions.contract_id, "
            "contracts.category AS contract_category "
            "FROM transactions LEFT JOIN contracts ON contracts.id = transactions.contract_id"
        )
    ).all()
    updates = [{"id": row.id, "source": source} for row in rows if (source := _classify(row)) != "AUTO"]
    if updates:
        connection.execute(
            statement=sa.text("UPDATE transactions SET category_source = :source WHERE id = :id"), parameters=updates
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_column("category_source")
