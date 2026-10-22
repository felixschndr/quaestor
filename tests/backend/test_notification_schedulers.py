from datetime import date
from unittest.mock import ANY, MagicMock

import pytest
from sqlalchemy.orm import sessionmaker

from source.backend.services.contracts import contract_overdue_scheduler
from source.backend.services.notifications import digest_scheduler


def test_overdue_check_evaluates_overdue_and_ending_contracts_for_today(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(target=contract_overdue_scheduler, name="SessionLocal", value=session_factory)
    evaluate_overdue = MagicMock()
    evaluate_ending = MagicMock()
    engine = contract_overdue_scheduler.notification_engine
    monkeypatch.setattr(target=engine, name="evaluate_overdue_contracts", value=evaluate_overdue)
    monkeypatch.setattr(target=engine, name="evaluate_ending_contracts", value=evaluate_ending)

    contract_overdue_scheduler._evaluate_overdue_contracts()

    evaluate_overdue.assert_called_once_with(db_session=ANY, today=date.today())
    evaluate_ending.assert_called_once_with(db_session=ANY, today=date.today())


def test_digest_run_evaluates_digests_for_today(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=digest_scheduler, name="SessionLocal", value=session_factory)
    evaluate_digests = MagicMock()
    monkeypatch.setattr(target=digest_scheduler.notification_engine, name="evaluate_digests", value=evaluate_digests)

    digest_scheduler._evaluate_digests()

    evaluate_digests.assert_called_once_with(db_session=ANY, today=date.today())
