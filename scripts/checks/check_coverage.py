#!/usr/bin/env python3

import json
import sys
from pathlib import Path

MIN_LINE_PERCENT = 95.0
MIN_BRANCH_PERCENT = 90.0


def main() -> int:
    totals = json.loads(Path("coverage.json").read_text())["totals"]
    errors: list[str] = []
    for label, key, minimum in (
        ("Line", "percent_statements_covered", MIN_LINE_PERCENT),
        ("Branch", "percent_branches_covered", MIN_BRANCH_PERCENT),
    ):
        percent = totals[key]
        print(f"{label} coverage: {percent:.2f}%")
        if percent < minimum:
            errors.append(f"{label} coverage of {percent:.2f}% is below the minimum of {minimum:.0f}%")

    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
