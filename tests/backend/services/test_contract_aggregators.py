from sqlalchemy.orm import Session, sessionmaker

from source.backend.services.contracts.contract_aggregators import (
    Fingerprint,
    compute_fingerprint,
)
from tests.backend.conftest import make_transaction, persist_account_with_new_user


def _fingerprint(
    session: Session, account_id: int, other_party: str | None, purpose: str | None = None
) -> Fingerprint | None:
    transaction = make_transaction(session, account_id=account_id, other_party=other_party, purpose=purpose)
    session.commit()
    return compute_fingerprint(transaction)


def test_paypal_purpose_yields_merchant_fingerprint(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)

    with session_factory() as session:
        fingerprint = _fingerprint(
            session,
            account_id=account_id,
            other_party="PayPal (Europe) S.a.r.l. et Cie., S.C.A.",
            purpose="1051133841173/PP.1922.PP/. Apple Services, Ihr Einkauf bei Apple Services",
        )

    assert fingerprint is not None
    assert fingerprint.key == "paypal:apple services"
    assert fingerprint.display_name == "Apple Services"


def test_paypal_transactions_to_different_merchants_get_different_keys(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)

    with session_factory() as session:
        apple = _fingerprint(
            session,
            account_id=account_id,
            other_party="PayPal Europe",
            purpose="998/PP.1.PP/. Apple Services, Ihr Einkauf bei Apple Services",
        )
        spotify = _fingerprint(
            session,
            account_id=account_id,
            other_party="PayPal Europe",
            purpose="777/PP.1.PP/. Spotify AB, Ihr Einkauf bei Spotify AB",
        )

    assert apple.key != spotify.key


def test_paypal_without_extractable_merchant_is_skipped(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)

    with session_factory() as session:
        result = _fingerprint(
            session, account_id=account_id, other_party="PayPal Europe", purpose="just a reference number"
        )

    assert result is None


def test_regular_other_party_uses_generic_fingerprint(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)

    with session_factory() as session:
        fingerprint = _fingerprint(session, account_id=account_id, other_party="Netflix", purpose="Abo")

    assert fingerprint.key == "party:netflix"
    assert fingerprint.display_name == "Netflix"


def test_missing_other_party_is_skipped(session_factory: sessionmaker):
    account_id = persist_account_with_new_user(session_factory)

    with session_factory() as session:
        assert _fingerprint(session, account_id=account_id, other_party=None, purpose="x") is None
        assert _fingerprint(session, account_id=account_id, other_party="   ", purpose="x") is None
