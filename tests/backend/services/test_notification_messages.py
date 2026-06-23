from source.backend.services import notification_messages


def test_translate_returns_language_specific_text():
    assert notification_messages.translate("en", key="transaction.title") == "Transaction booked"
    assert notification_messages.translate("de", key="transaction.title") == "Transaktion gebucht"


def test_translate_fills_placeholders():
    assert (
        notification_messages.translate(
            "de", key="balance_below.body", account="Giro", amount="40.00 €", threshold="50.00 €"
        )
        == "Giro: 40.00 € (Schwelle 50.00 €)"
    )


def test_translate_falls_back_to_default_language_for_unknown_language():
    assert notification_messages.translate("fr", key="transaction.title") == "Transaction booked"
