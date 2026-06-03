import os
from pathlib import Path

from dotenv import load_dotenv
from source.backend.helpers import get_root_path_of_repository

DATA_DIR_ENV_VARIABLE_NAME = "DATA_DIR"

ROOT = get_root_path_of_repository()
ENV_FILE_PATH = ROOT / ".env"

load_dotenv(dotenv_path=ENV_FILE_PATH)


def _resolve_data_dir() -> Path:
    return Path(os.environ.get(DATA_DIR_ENV_VARIABLE_NAME) or (ROOT / "data"))


DATA_DIR = _resolve_data_dir()

DATABASE_PATH = DATA_DIR / "Quaestor.db"
BANK_DB_PATH = DATA_DIR / "bank_info.pickle"
PLAYWRIGHT_BROWSERS_PATH = DATA_DIR / "playwright"

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)
