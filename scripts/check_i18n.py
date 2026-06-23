#!/usr/bin/env python3
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from source.backend.helpers import (  # noqa: E402
    get_backend_source_path,
    get_frontend_source_path,
)
from source.backend.services.i18n_service import SUPPORTED_LANGUAGES  # noqa: E402
from source.backend.services.notification_messages import (  # noqa: E402
    _TRANSLATION_CATALOG,
)

FRONTEND_SOURCE_PATH = get_frontend_source_path()
FRONTEND_LOCALES_PATH = FRONTEND_SOURCE_PATH / "i18n/locales"
BACKEND_SOURCE_PATH = get_backend_source_path()

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


def extract_backend_translate_keys(backend_dir: Path) -> set[str]:
    # Collect every key passed to notification_messages.translate(..., key="...")
    keys: set[str] = set()
    for path in backend_dir.rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            is_translate = (
                isinstance(func, ast.Attribute)
                and func.attr == "translate"
                and isinstance(func.value, ast.Name)
                and func.value.id == "notification_messages"
            )
            if not is_translate:
                continue
            for keyword in node.keywords:
                if keyword.arg == "key" and isinstance(keyword.value, ast.Constant):
                    keys.add(keyword.value.value)
    return keys


def report_languages_must_match_supported(errors: list[str], languages: set[str], label: str) -> None:
    supported_languages = set(SUPPORTED_LANGUAGES)
    if languages != supported_languages:
        errors.append(
            f"[{label}] languages {sorted(languages)} do not match supported languages {sorted(supported_languages)}"
        )


def report_keys_missing_in_some_language(
    errors: list[str], keys_by_language: dict[str, set[str]], label: str
) -> set[str]:
    union = set().union(*keys_by_language.values()) if keys_by_language else set()
    for language, keys in keys_by_language.items():
        for key in sorted(union - keys):
            errors.append(f"[{label}:{language}] key missing (present in other languages): {key}")
    return union


def check_frontend_messages(errors: list[str]) -> None:
    literals, patterns, any_strings = extract_keys(FRONTEND_SOURCE_PATH)
    keys_by_language = {
        path.stem: set(flatten(json.loads(path.read_text()))) for path in sorted(FRONTEND_LOCALES_PATH.glob("*.json"))
    }

    report_languages_must_match_supported(errors, languages=set(keys_by_language), label="frontend")
    report_keys_missing_in_some_language(errors, keys_by_language, label="frontend")

    for language, keys in keys_by_language.items():
        for literal in sorted(literals):
            if literal in keys:
                continue
            if any(f"{literal}{suffix}" in keys for suffix in PLURAL_SUFFIXES):
                continue
            if matches_any(literal, patterns):
                continue
            errors.append(f"[frontend:{language}] missing translation for key used in code: {literal}")
        for key in sorted(keys):
            base = strip_plural(key)
            if key in any_strings or base in any_strings:
                continue
            if matches_any(key, patterns) or matches_any(base, patterns):
                continue
            errors.append(f"[frontend:{language}] unused translation key: {key}")


def check_backend_messages(errors: list[str]) -> None:
    keys_by_language = {language: set(keys) for language, keys in _TRANSLATION_CATALOG.items()}

    report_languages_must_match_supported(errors, languages=set(keys_by_language), label="backend")
    message_keys = report_keys_missing_in_some_language(errors, keys_by_language, label="backend")

    # The keys used in code must be exactly the keys defined in _MESSAGES.
    used_keys = extract_backend_translate_keys(BACKEND_SOURCE_PATH)
    for key in sorted(used_keys - message_keys):
        errors.append(f"[backend] notification key used in code but missing from translation catalog: {key}")
    for key in sorted(message_keys - used_keys):
        errors.append(f"[backend] notification key defined in translation catalog but unused in code: {key}")


def main() -> int:
    errors: list[str] = []
    check_frontend_messages(errors)
    check_backend_messages(errors)
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
