from alembic import command
from alembic.config import Config
from source.backend.helpers import get_root_path_of_repository
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_ALEMBIC_INI = get_root_path_of_repository() / "alembic.ini"


def upgrade_to_head() -> None:
    logger.info(f"Applying database migrations to head using {_ALEMBIC_INI}")
    config = Config(file_=str(_ALEMBIC_INI))
    command.upgrade(config=config, revision="head")
    logger.info("Database migrations now are at head")
