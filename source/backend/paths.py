import os
from pathlib import Path

from dotenv import load_dotenv

from source.backend.helpers import get_root_path_of_repository

DATA_DIR_ENV_VARIABLE_NAME = "DATA_DIR"

ROOT = get_root_path_of_repository()
ENV_FILE_PATH = ROOT / ".env"

load_dotenv(dotenv_path=ENV_FILE_PATH)


DATA_DIR = Path(os.environ.get(DATA_DIR_ENV_VARIABLE_NAME) or (ROOT / "data"))

DATABASE_PATH = DATA_DIR / "Quaestor.db"
BANK_DB_PATH = DATA_DIR / "bank_info.pickle"
ENABLE_BANKING_ASPSPS_PATH = DATA_DIR / "enable_banking_aspsps.json"
PLAYWRIGHT_BROWSERS_PATH = DATA_DIR / "playwright"

os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)
