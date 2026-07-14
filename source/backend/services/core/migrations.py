from alembic import command
from alembic.config import Config

from source.backend.helpers import get_root_path_of_repository
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_REPO_ROOT = get_root_path_of_repository()
_ALEMBIC_INI = _REPO_ROOT / "alembic.ini"
_ALEMBIC_SCRIPTS = _REPO_ROOT / "source" / "backend" / "alembic"


def upgrade_to_head() -> None:
    logger.info(f"Applying database migrations to head using {_ALEMBIC_INI}")
    config = Config(file_=str(_ALEMBIC_INI))
    config.set_main_option(name="script_location", value=str(_ALEMBIC_SCRIPTS))
    command.upgrade(config=config, revision="head")
    logger.info("Database migrations now are at head")
