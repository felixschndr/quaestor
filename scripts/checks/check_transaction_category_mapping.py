#!/usr/bin/env python3

# Every matcher in TRANSACTION_CATEGORY_MAPPING must already be in normalized form and sorted per category. A matcher may
# only appear in a second category when its first category is incoming-only, otherwise the second one is unreachable.
# Every category (except UNKNOWN) belongs to exactly one group.

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from source.backend.models.transactions.transaction_category import (
    CATEGORIES_BY_GROUP,
    CATEGORY_GROUP,
    INCOMING_ONLY_GROUPS,
    TRANSACTION_CATEGORY_MAPPING,
    TransactionCategory,
    normalize_string,
)


def main() -> int:
    errors: list[str] = []
    seen: dict[str, list[TransactionCategory]] = defaultdict(list)
    for category, matchers in TRANSACTION_CATEGORY_MAPPING.items():
        if matchers != sorted(matchers):
            errors.append(
                f"The matchers of {category.name} are not sorted\n\tCurrent:\t{matchers}\n\tShould be:\t{sorted(matchers)}"
            )
        for matcher in matchers:
            normalized = normalize_string(matcher)
            if normalized != matcher:
                errors.append(f"[{category.name}] matcher {matcher!r} must be normalized to {normalized!r}")
            seen[matcher].append(category)

    for matcher, categories in sorted(seen.items()):
        if len(categories) == 1:
            continue
        first, *rest = categories
        if (
            len(rest) > 1
            or CATEGORY_GROUP[first] not in INCOMING_ONLY_GROUPS
            or CATEGORY_GROUP[rest[0]] in INCOMING_ONLY_GROUPS
        ):
            errors.append(
                f"Matcher {matcher!r} appears in {', '.join(category.name for category in categories)}; a duplicate is "
                "only allowed once, with the first category incoming-only and the second one not"
            )

    grouped = [category for categories in CATEGORIES_BY_GROUP.values() for category in categories]
    for category in TransactionCategory:
        occurrences = grouped.count(category)
        if category is TransactionCategory.UNKNOWN:
            if occurrences:
                errors.append("UNKNOWN must not belong to a group")
        elif occurrences != 1:
            errors.append(f"{category.name} must belong to exactly one group (found {occurrences})")

    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
