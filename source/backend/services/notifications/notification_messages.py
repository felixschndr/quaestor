from source.backend.services.core import i18n_service

_TRANSLATION_CATALOG: dict[str, dict[str, str]] = {
    "en": {
        "expected_transaction.title": "Expected transaction booked",
        "expected_transaction.body": "{account}: {amount} booked",
        "expected_transaction.body_minimal": "{account}",
        "transaction.title": "Transaction booked",
        "transaction.body": "{account}: {amount}",
        "transaction.body_minimal": "{account}",
        "balance_below.title": "Balance below threshold",
        "balance_below.body": "{account}: {amount} (threshold {threshold})",
        "balance_above.title": "Balance above threshold",
        "balance_above.body": "{account}: {amount} (threshold {threshold})",
        "balance_threshold.body_minimal": "{account}",
        "contract_overdue.title": "Payment overdue",
        "contract_overdue.body": "{account}: {name} overdue since {date}",
        "contract_overdue.body_minimal": "{account}",
        "duplicate_transaction.title": "Possible duplicate booking",
        "duplicate_transaction.body": "{account}: {amount} · {other_party} booked twice within {days} days",
        "duplicate_transaction.body_minimal": "{account}",
        "contract_amount_increased.title": "Contract amount increased",
        "contract_amount_increased.body": "{account}: {name} {amount} instead of {previous}",
        "contract_amount_increased.body_minimal": "{account}",
        "upcoming_shortfall.title": "Upcoming payments exceed balance",
        "upcoming_shortfall.body": "{account}: {due} due within {days} days, only {amount} available",
        "upcoming_shortfall.body_minimal": "{account}",
        "test.body": "🔔 Test notification → push works!",
    },
    "de": {
        "expected_transaction.title": "Erwartete Transaktion gebucht",
        "expected_transaction.body": "{account}: {amount} gebucht",
        "expected_transaction.body_minimal": "{account}",
        "transaction.title": "Transaktion gebucht",
        "transaction.body": "{account}: {amount}",
        "transaction.body_minimal": "{account}",
        "balance_below.title": "Kontostand unterschritten",
        "balance_below.body": "{account}: {amount} (Schwelle {threshold})",
        "balance_above.title": "Kontostand überschritten",
        "balance_above.body": "{account}: {amount} (Schwelle {threshold})",
        "balance_threshold.body_minimal": "{account}",
        "contract_overdue.title": "Zahlung überfällig",
        "contract_overdue.body": "{account}: {name} überfällig seit {date}",
        "contract_overdue.body_minimal": "{account}",
        "duplicate_transaction.title": "Mögliche Doppelbuchung",
        "duplicate_transaction.body": "{account}: {amount} · {other_party} zweimal in {days} Tagen",
        "duplicate_transaction.body_minimal": "{account}",
        "contract_amount_increased.title": "Vertragsbetrag gestiegen",
        "contract_amount_increased.body": "{account}: {name} {amount} statt {previous}",
        "contract_amount_increased.body_minimal": "{account}",
        "upcoming_shortfall.title": "Anstehende Zahlungen über Kontostand",
        "upcoming_shortfall.body": "{account}: {due} fällig in {days} Tagen, nur {amount} verfügbar",
        "upcoming_shortfall.body_minimal": "{account}",
        "test.body": "🔔 Testbenachrichtigung → Push funktioniert!",
    },
}


def translate(language: str, key: str, **params: object) -> str:
    catalog = _TRANSLATION_CATALOG.get(language) or _TRANSLATION_CATALOG[i18n_service.DEFAULT_LANGUAGE]
    template = catalog.get(key) or _TRANSLATION_CATALOG[i18n_service.DEFAULT_LANGUAGE][key]
    return template.format(**params)
