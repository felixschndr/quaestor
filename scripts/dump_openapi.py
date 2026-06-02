from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ALLOW_MISSING_FRONTEND", "true")

from source.backend.main import app  # noqa: E402


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "openapi.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
    print(f"Wrote OpenAPI spec ({len(app.openapi()['paths'])} paths) to {out_path}")


if __name__ == "__main__":
    main()
