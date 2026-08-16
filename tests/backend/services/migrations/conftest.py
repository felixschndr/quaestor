import importlib.util
from collections.abc import Callable
from types import ModuleType

import pytest
from sqlalchemy import Engine, create_engine

from source.backend.helpers import get_backend_source_path


@pytest.fixture
def load_migration() -> Callable[[int], ModuleType]:
    def _load(revision: int) -> ModuleType:
        pattern = f"{revision:04d}_*.py"
        matches = sorted((get_backend_source_path() / "alembic" / "versions").glob(pattern))
        if len(matches) != 1:
            raise FileNotFoundError(f"expected exactly one migration matching {pattern}, found {matches}")
        spec = importlib.util.spec_from_file_location(name=matches[0].stem, location=matches[0])
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    return _load


@pytest.fixture
def migration_test_engine() -> Engine:
    return create_engine("sqlite://")
