"""Move categories into groups: retire SUBSCRIPTIONS, UTILITIES and TRAVEL and split several others

SQLite stores the category enum as a plain VARCHAR without a CHECK constraint, so only the data changes:
- Categories that no longer exist move to their closest successor. Automatically assigned ones are re-derived by the
  startup re-scan anyway; members of a contract become automatic again and the contract loses its category, so contract
  detection derives it afresh from the re-derived members.
- Notification rules keep matching at least what they matched before: a retired or narrowed category is replaced by all
  categories that inherited its matchers, and a selection of every old category becomes a selection of every group.

Revision ID: 0071
Revises: 0070
Create Date: 2026-09-15 14:00:00.000000
"""

import json
from collections.abc import Callable
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0071"
down_revision: Union[str, None] = "0070"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RETIRED = {
    "TRAVEL": "VACATION",
    "SUBSCRIPTIONS": "ENTERTAINMENT",
    "UTILITIES": "OTHER_HOUSING",
}

_OLD_CATEGORIES = frozenset(
    {
        "SALARY",
        "ALLOWANCE",
        "PENSION",
        "SIDE_INCOME",
        "REIMBURSEMENT",
        "INTEREST",
        "INVESTMENT",
        "SUBSCRIPTIONS",
        "RENT",
        "UTILITIES",
        "TRAVEL",
        "FUEL",
        "FITNESS",
        "ONLINE_SHOPPING",
        "SUPERMARKET",
        "DRUGSTORE",
        "RESTAURANTS",
        "PERSONAL_CARE",
        "CLOTHING",
        "GIFTS",
        "ENTERTAINMENT",
        "FEES",
        "SAVINGS",
        "WITHDRAWAL",
        "DEPOSIT",
        "TRANSFER",
        "UNKNOWN",
    }
)

_GROUPS = (
    "INCOME",
    "FOOD_AND_DRINK",
    "HOUSING",
    "MOBILITY",
    "LEISURE",
    "SHOPPING",
    "HEALTH",
    "INSURANCE",
    "FINANCES",
    "SAVINGS_AND_INVESTMENTS",
    "CHILDREN",
    "PETS",
    "MISCELLANEOUS",
)

# Every category that inherited matchers from an old one
_SELECTION_SUCCESSORS = {
    "TRAVEL": ("VACATION", "CAR", "PUBLIC_TRANSPORT", "SHARING_TAXI", "OTHER_MOBILITY"),
    "SUBSCRIPTIONS": ("STREAMING", "SOFTWARE_CLOUD"),
    "UTILITIES": ("ELECTRICITY", "HEATING", "INTERNET_PHONE", "BROADCASTING_FEE"),
    "FEES": ("FEES", "BANK_FEES", "TAXES", "LEGAL", "EDUCATION", "PARKING", "HEALTH_INSURANCE", "OTHER_INSURANCE"),
    "PERSONAL_CARE": ("PERSONAL_CARE", "PHARMACY", "DOCTOR", "HEALTH_INSURANCE"),
    "ENTERTAINMENT": ("ENTERTAINMENT", "EVENTS", "GAMING"),
    "ONLINE_SHOPPING": ("ONLINE_SHOPPING", "ELECTRONICS", "FURNISHING"),
}

# Downgrade: every new key back to the old category that held its matchers (or UNKNOWN when there was none)
_PREDECESSOR = {
    "PUBLIC_BENEFITS": "ALLOWANCE",
    "RENTAL_INCOME": "SIDE_INCOME",
    "PRIVATE_SALES": "SIDE_INCOME",
    "OTHER_INCOME": "UNKNOWN",
    "FOOD_DELIVERY": "RESTAURANTS",
    "ELECTRICITY": "UTILITIES",
    "HEATING": "UTILITIES",
    "INTERNET_PHONE": "UTILITIES",
    "BROADCASTING_FEE": "UTILITIES",
    "OTHER_HOUSING": "UTILITIES",
    "FURNISHING": "ONLINE_SHOPPING",
    "PUBLIC_TRANSPORT": "TRAVEL",
    "CAR": "TRAVEL",
    "SHARING_TAXI": "TRAVEL",
    "OTHER_MOBILITY": "TRAVEL",
    "VACATION": "TRAVEL",
    "PARKING": "FEES",
    "EVENTS": "ENTERTAINMENT",
    "GAMING": "ENTERTAINMENT",
    "STREAMING": "SUBSCRIPTIONS",
    "SOFTWARE_CLOUD": "SUBSCRIPTIONS",
    "ELECTRONICS": "ONLINE_SHOPPING",
    "PHARMACY": "PERSONAL_CARE",
    "DOCTOR": "PERSONAL_CARE",
    "HEALTH_INSURANCE": "FEES",
    "OTHER_INSURANCE": "FEES",
    "BANK_FEES": "FEES",
    "TAXES": "FEES",
    "LEGAL": "FEES",
    "EDUCATION": "FEES",
    "DONATION": "FEES",
    "CHILDCARE": "UNKNOWN",
    "POCKET_MONEY": "ALLOWANCE",
    "OTHER_CHILDREN": "UNKNOWN",
    "PET_SUPPLIES": "UNKNOWN",
    "VET": "UNKNOWN",
    "CREDIT_CARD_SETTLEMENT": "TRANSFER",
}

# Downgrade: the categories of each group as of this revision
_GROUP_CATEGORIES = {
    "INCOME": (
        "SALARY",
        "SIDE_INCOME",
        "PENSION",
        "ALLOWANCE",
        "PUBLIC_BENEFITS",
        "RENTAL_INCOME",
        "INTEREST",
        "PRIVATE_SALES",
        "REIMBURSEMENT",
        "OTHER_INCOME",
    ),
    "FOOD_AND_DRINK": ("SUPERMARKET", "RESTAURANTS", "FOOD_DELIVERY"),
    "HOUSING": (
        "RENT",
        "ELECTRICITY",
        "HEATING",
        "INTERNET_PHONE",
        "BROADCASTING_FEE",
        "FURNISHING",
        "OTHER_HOUSING",
    ),
    "MOBILITY": ("FUEL", "PUBLIC_TRANSPORT", "CAR", "PARKING", "SHARING_TAXI", "OTHER_MOBILITY"),
    "LEISURE": ("VACATION", "FITNESS", "EVENTS", "STREAMING", "GAMING", "ENTERTAINMENT"),
    "SHOPPING": ("ONLINE_SHOPPING", "CLOTHING", "ELECTRONICS", "SOFTWARE_CLOUD", "GIFTS"),
    "HEALTH": ("DRUGSTORE", "PHARMACY", "DOCTOR", "PERSONAL_CARE"),
    "INSURANCE": ("HEALTH_INSURANCE", "OTHER_INSURANCE"),
    "FINANCES": ("BANK_FEES", "TAXES", "LEGAL", "EDUCATION", "DONATION", "FEES"),
    "SAVINGS_AND_INVESTMENTS": ("SAVINGS", "INVESTMENT"),
    "CHILDREN": ("CHILDCARE", "POCKET_MONEY", "OTHER_CHILDREN"),
    "PETS": ("PET_SUPPLIES", "VET"),
    "MISCELLANEOUS": ("WITHDRAWAL", "DEPOSIT", "TRANSFER", "CREDIT_CARD_SETTLEMENT"),
}


def _upgrade_selection(selection: list[str]) -> list[str]:
    if set(selection) >= _OLD_CATEGORIES:
        return [*_GROUPS, "UNKNOWN"]
    upgraded = [successor for category in selection for successor in _SELECTION_SUCCESSORS.get(category, (category,))]
    return list(dict.fromkeys(upgraded))


def _downgrade_selection(selection: list[str]) -> list[str]:
    categories = [category for item in selection for category in _GROUP_CATEGORIES.get(item, (item,))]
    predecessors = [_PREDECESSOR[category] if category in _PREDECESSOR else category for category in categories]
    return list(dict.fromkeys(predecessors))


def _rewrite_notification_rules(connection: sa.Connection, rewrite: Callable[[list[str]], list[str]]) -> None:
    rows = connection.execute(sa.text("SELECT id, categories FROM notification_rules")).all()
    updates = []
    for rule_id, raw in rows:
        selection = json.loads(raw) if raw else []
        rewritten = rewrite(selection)
        if rewritten != selection:
            updates.append({"id": rule_id, "categories": json.dumps(rewritten)})
    if updates:
        connection.execute(
            statement=sa.text("UPDATE notification_rules SET categories = :categories WHERE id = :id"),
            parameters=updates,
        )


def _remap_columns(connection: sa.Connection, mapping: dict[str, str]) -> None:
    for old, new in mapping.items():
        parameters = {"old": old, "new": new}
        for table in ("transactions", "recurring_transactions"):
            connection.execute(
                statement=sa.text(f"UPDATE {table} SET category = :new WHERE category = :old"),  # nosec B608
                parameters=parameters,
            )


def upgrade() -> None:
    connection = op.get_bind()
    retired = tuple(_RETIRED)
    connection.execute(
        statement=sa.text(
            "UPDATE transactions SET category_source = 'AUTO' "
            "WHERE category_source = 'CONTRACT' AND category IN :retired"
        ).bindparams(sa.bindparam("retired", expanding=True)),
        parameters={"retired": retired},
    )
    connection.execute(
        statement=sa.text("UPDATE contracts SET category = NULL WHERE category IN :retired").bindparams(
            sa.bindparam("retired", expanding=True)
        ),
        parameters={"retired": retired},
    )
    _remap_columns(connection=connection, mapping=_RETIRED)
    _rewrite_notification_rules(connection=connection, rewrite=_upgrade_selection)


def downgrade() -> None:
    connection = op.get_bind()
    _remap_columns(connection=connection, mapping=_PREDECESSOR)
    for new, old in _PREDECESSOR.items():
        connection.execute(
            statement=sa.text("UPDATE contracts SET category = :old WHERE category = :new"),
            parameters={"old": old, "new": new},
        )
    _rewrite_notification_rules(connection=connection, rewrite=_downgrade_selection)
