from pathlib import Path
from unittest.mock import MagicMock

import pytest
from source.backend.services import migrations

from tests.backend.conftest import assert_log_contains

_real_upgrade_to_head = migrations.upgrade_to_head


def test_upgrade_to_head_invokes_alembic_with_repo_config(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    fake_config_class = MagicMock(side_effect=lambda file_: MagicMock(name=f"Config({file_})", file_=file_))
    fake_upgrade = MagicMock()
    monkeypatch.setattr(target=migrations.command, name="upgrade", value=fake_upgrade)
    monkeypatch.setattr(target=migrations, name="Config", value=fake_config_class)

    _real_upgrade_to_head()

    assert_log_contains(
        caplog, messages=["Applying database migrations to head", "Database migrations now are at head"]
    )
    fake_config_class.assert_called_once()
    ini_path = Path(fake_config_class.call_args.kwargs["file_"])
    assert ini_path.name == "alembic.ini"
    assert ini_path.is_file()
    fake_upgrade.assert_called_once()
    assert fake_upgrade.call_args.kwargs["revision"] == "head"


def test_upgrade_to_head_propagates_alembic_errors(monkeypatch: pytest.MonkeyPatch):
    def failing_migration(config: object, revision: str) -> None:
        raise RuntimeError("migration failed")

    monkeypatch.setattr(target=migrations.command, name="upgrade", value=failing_migration)
    monkeypatch.setattr(target=migrations, name="Config", value=MagicMock())

    with pytest.raises(RuntimeError, match="migration failed"):
        _real_upgrade_to_head()
