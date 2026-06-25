import pytest
from source.backend.logging_utils import get_logger
from source.backend.models.base import snapshot_columns
from sqlalchemy.orm import sessionmaker

from tests.backend.conftest import DISPLAY_NAME, make_user


def test_logger_update_reports_old_repr_new_repr_and_diff(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    logger = get_logger("test.log_update")
    with session_factory() as session:
        user = make_user(session)
        state_before_update = snapshot_columns(user)
        user.display_name = "Renamed"
        user.language = "de"

        logger.update(state_before_update=state_before_update, entity_after_update=user)

    message = caplog.records[-1].getMessage()
    assert f"display_name={DISPLAY_NAME}" in message
    assert "display_name=Renamed" in message
    assert f"display_name: {DISPLAY_NAME} → Renamed" in message
    assert "language: en → de" in message
    assert "user_name:" not in message


def test_logger_update_reports_no_changes_when_nothing_changed(
    session_factory: sessionmaker, caplog: pytest.LogCaptureFixture
):
    logger = get_logger("test.log_update")
    with session_factory() as session:
        user = make_user(session)
        state_before_update = snapshot_columns(user)

        logger.update(state_before_update=state_before_update, entity_after_update=user)

    assert "No changes to User" in caplog.records[-1].getMessage()
