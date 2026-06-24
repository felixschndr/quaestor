from source.backend.services import i18n_service

_TRANSLATION_CATALOG: dict[str, dict[str, str]] = {
    "en": {
        "expected_transaction.title": "Expected transaction booked",
        "expected_transaction.body": "{account}: {amount} booked.",
        "expected_transaction.body_minimal": "{account}",
        "transaction.title": "Transaction booked",
        "transaction.body": "{account}: {amount}",
        "transaction.body_minimal": "{account}",
        "balance_below.title": "Balance below threshold",
        "balance_below.body": "{account}: {amount} (threshold {threshold})",
        "balance_above.title": "Balance above threshold",
        "balance_above.body": "{account}: {amount} (threshold {threshold})",
        "balance_threshold.body_minimal": "{account}",
        "test.body": "🔔 Test notification → push works!",
    },
    "de": {
        "expected_transaction.title": "Erwartete Transaktion gebucht",
        "expected_transaction.body": "{account}: {amount} gebucht.",
        "expected_transaction.body_minimal": "{account}",
        "transaction.title": "Transaktion gebucht",
        "transaction.body": "{account}: {amount}",
        "transaction.body_minimal": "{account}",
        "balance_below.title": "Kontostand unterschritten",
        "balance_below.body": "{account}: {amount} (Schwelle {threshold})",
        "balance_above.title": "Kontostand überschritten",
        "balance_above.body": "{account}: {amount} (Schwelle {threshold})",
        "balance_threshold.body_minimal": "{account}",
        "test.body": "🔔 Testbenachrichtigung → Push funktioniert!",
    },
}


def translate(language: str, key: str, **params: object) -> str:
    catalog = _TRANSLATION_CATALOG.get(language) or _TRANSLATION_CATALOG[i18n_service.DEFAULT_LANGUAGE]
    template = catalog.get(key) or _TRANSLATION_CATALOG[i18n_service.DEFAULT_LANGUAGE][key]
    return template.format(**params)
