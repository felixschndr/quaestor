import select
import subprocess  # nosec B404
import sys
import time
from pathlib import Path

from source.backend.helpers import get_project_version, get_root_path_of_repository

_ENV_FOR_FRESH_DATA_DIR = {"DATABASE_ENCRYPTION_KEY": "test-key", "PORT": "0", "ALLOW_MISSING_FRONTEND": "true"}

_EXPECTED_STARTUP_LOGS = (
    f"Starting Quaestor {get_project_version()}",
    "Applying database migrations to head",
    "Database migrations now are at head",
    "Uvicorn running on",
    "Application startup complete.",
)

_STARTUP_TIMEOUT_SECONDS = 10

_SKIP_STARTUP_UPDATES_SITECUSTOMIZE = """
import os
import sys

sys.path.insert(0, os.getcwd())

from source.backend.services.banking import enable_banking_catalog, fints_db_updater


async def _skip_startup_update():
    pass


fints_db_updater.run_startup_update = _skip_startup_update
enable_banking_catalog.run_startup_update = _skip_startup_update
"""


def _inject_skipped_startup_updates(tmp_path: Path) -> str:
    site_dir = tmp_path / "sitecustomize"
    site_dir.mkdir()
    (site_dir / "sitecustomize.py").write_text(_SKIP_STARTUP_UPDATES_SITECUSTOMIZE)
    return str(site_dir)


def _fake_chromium(env: dict) -> None:
    # Pre-create the chromium executable the startup looks for, so it skips the real download
    code = (
        "import asyncio; "
        "from source.backend.services.banking.playwright_browser import _chromium_executable_path; "
        "path = asyncio.run(_chromium_executable_path()); "
        "path.parent.mkdir(parents=True, exist_ok=True); path.touch()"
    )
    subprocess.run(  # nosec B603
        [sys.executable, "-c", code],  # noqa FKA100
        cwd=get_root_path_of_repository(),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def test_fresh_startup_runs_migrations_and_listens(tmp_path: Path):
    env = _ENV_FOR_FRESH_DATA_DIR | {
        "DATA_DIR": str(tmp_path / "data"),
        "PYTHONPATH": _inject_skipped_startup_updates(tmp_path),
    }
    _fake_chromium(env)

    server = subprocess.Popen(  # nosec B603
        [sys.executable, "-m", "source.backend.server"],  # noqa FKA100
        cwd=get_root_path_of_repository(),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    output: list[str] = []
    try:
        missing = list(_EXPECTED_STARTUP_LOGS)
        deadline = time.monotonic() + _STARTUP_TIMEOUT_SECONDS
        while missing and time.monotonic() < deadline:
            ready, _, _ = select.select([server.stdout], [], [], 1.0)  # noqa FKA100
            if not ready:
                if server.poll() is not None:
                    break  # server died without the expected logs
                continue
            line = server.stdout.readline()
            if not line:
                break
            output.append(line)
            missing = [message for message in missing if message not in line]
        assert not missing, f"Startup logs missing {missing}. Output:\n{''.join(output)}"
    finally:
        server.terminate()
        server.wait(timeout=10)
