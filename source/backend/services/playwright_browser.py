import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

BROWSER = "chromium"


async def _chromium_executable_path() -> Path:
    async with async_playwright() as playwright:
        return Path(playwright.chromium.executable_path)


async def _download_chromium() -> None:
    command = [sys.executable, "-m", "playwright", "install", BROWSER]
    process = await asyncio.create_subprocess_exec(
        *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    stdout, _ = await process.communicate()
    output = stdout.decode(errors="replace").strip()
    if process.returncode != 0:
        raise RuntimeError(f"`playwright install {BROWSER}` failed (exit code {process.returncode}):\n{output}")
    if output:
        logger.debug(f"Playwright install output:\n{output}")


async def ensure_chromium_installed() -> None:
    executable_path = await _chromium_executable_path()
    if executable_path.exists():
        logger.debug(f"Playwright {BROWSER} browser already present at {executable_path}")
        return

    logger.info(
        f"Playwright {BROWSER} browser not found at {executable_path}; downloading it into "
        f"{os.environ.get('PLAYWRIGHT_BROWSERS_PATH')}. This happens once per version and may take a moment ..."
    )
    try:
        await _download_chromium()
    except Exception:
        logger.exception(f"Failed to download the Playwright {BROWSER} browser")
        return

    logger.info(f"Playwright {BROWSER} browser downloaded successfully")
