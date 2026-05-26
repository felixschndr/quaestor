#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source/frontend/src"
LOCALES = SRC / "i18n/locales"

PLURAL_SUFFIXES = ("_zero", "_one", "_two", "_few", "_many", "_other")

LITERAL_RE = re.compile(r"""\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]""")
TEMPLATE_RE = re.compile(r"""\bt\(\s*`([^`]+)`""")
I18NKEY_RE = re.compile(r"""i18nKey\s*=\s*['"]([a-zA-Z0-9_.]+)['"]""")
ANY_STRING_RE = re.compile(r"""['"`]([a-zA-Z][a-zA-Z0-9_.]*)['"`]""")


def template_to_regex(raw: str) -> re.Pattern:
    parts = re.split(r"\$\{[^}]+\}", raw)
    return re.compile("^" + "[^.]+".join(re.escape(p) for p in parts) + "$")


def extract_keys(src_dir: Path) -> tuple[set[str], list[re.Pattern], set[str]]:
    literals: set[str] = set()
    patterns: list[re.Pattern] = []
    any_strings: set[str] = set()
    for path in src_dir.rglob("*.ts*"):
        if "__tests__" in path.parts or path.name.endswith(".gen.ts"):
            continue
        text = path.read_text()
        literals.update(LITERAL_RE.findall(text))
        literals.update(I18NKEY_RE.findall(text))
        any_strings.update(ANY_STRING_RE.findall(text))
        for raw in TEMPLATE_RE.findall(text):
            if "${" in raw:
                patterns.append(template_to_regex(raw))
            else:
                literals.add(raw)
    return literals, patterns, any_strings


def flatten(d: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def strip_plural(key: str) -> str:
    for suf in PLURAL_SUFFIXES:
        if key.endswith(suf):
            return key[: -len(suf)]
    return key


def matches_any(key: str, patterns: list[re.Pattern]) -> bool:
    return any(p.match(key) for p in patterns)


def main() -> int:
    literals, patterns, any_strings = extract_keys(SRC)
    locales = {p.stem: flatten(json.loads(p.read_text())) for p in sorted(LOCALES.glob("*.json"))}

    errors: list[str] = []

    union = set().union(*(set(k) for k in locales.values())) if locales else set()
    for lang, keys in locales.items():
        for k in sorted(union - set(keys)):
            errors.append(f"[{lang}] key missing (present in other languages): {k}")

    for lang, keys in locales.items():
        present = set(keys)
        for lit in sorted(literals):
            if lit in present:
                continue
            if any(f"{lit}{suf}" in present for suf in PLURAL_SUFFIXES):
                continue
            if matches_any(lit, patterns):
                continue
            errors.append(f"[{lang}] missing translation for key: {lit}")
        for key in sorted(present):
            base = strip_plural(key)
            if key in any_strings or base in any_strings:
                continue
            if matches_any(key, patterns) or matches_any(base, patterns):
                continue
            errors.append(f"[{lang}] unused translation key: {key}")

    if errors:
        for e in errors:
            print(e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
