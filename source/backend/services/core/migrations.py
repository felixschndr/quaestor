from alembic import command
from alembic.config import Config

from source.backend.helpers import (
    get_backend_source_path,
    get_pyproject_toml_path,
    get_root_path_of_repository,
)
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

_REPO_ROOT = get_root_path_of_repository()
_PYPROJECT = get_pyproject_toml_path()
_ALEMBIC_SCRIPTS = get_backend_source_path() / "alembic"


def upgrade_to_head() -> None:
    logger.info(f"Applying database migrations to head using {_PYPROJECT}")
    config = Config(toml_file=str(_PYPROJECT))
    config.set_main_option(name="script_location", value=str(_ALEMBIC_SCRIPTS))
    command.upgrade(config=config, revision="head")
    logger.info("Database migrations now are at head")
