#!/usr/bin/env python3

# Every matcher in TRANSACTION_TYPE_MAPPING must already be in normalized form and unique across all categories

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from source.backend.models.transactions.transaction_category import (
    TRANSACTION_CATEGORY_MAPPING,
    normalize_string,
)


def main() -> int:
    not_normalized: list[tuple[str, str, str]] = []
    seen: dict[str, list[str]] = defaultdict(list)
    for category, matchers in TRANSACTION_CATEGORY_MAPPING.items():
        for matcher in matchers:
            normalized = normalize_string(matcher)
            if normalized != matcher:
                not_normalized.append((category.name, matcher, normalized))
            seen[matcher].append(category.name)

    duplicates = {matcher: categories for matcher, categories in seen.items() if len(categories) > 1}

    if not not_normalized and not duplicates:
        return 0

    if not_normalized:
        print("TRANSACTION_TYPE_MAPPING entries must already be normalized:")
        for category_name, raw, normalized in not_normalized:
            print(f"  [{category_name}] {raw!r} → {normalized!r}")

    if duplicates:
        print("TRANSACTION_TYPE_MAPPING entries must be unique across categories:")
        for matcher, categories in sorted(duplicates.items()):
            print(f"  {matcher!r} appears in: {', '.join(categories)}")

    return 1


if __name__ == "__main__":
    sys.exit(main())
