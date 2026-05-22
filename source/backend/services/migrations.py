from pathlib import Path

from alembic import command
from alembic.config import Config
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent.parent / "alembic.ini"


def upgrade_to_head() -> None:
    logger.info(f"Applying database migrations to head using {_ALEMBIC_INI}")
    config = Config(file_=str(_ALEMBIC_INI))
    command.upgrade(config=config, revision="head")
    logger.info("Database migrations are at head")
