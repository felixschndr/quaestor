import asyncio
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

from source.backend.logging_utils import get_logger
from source.backend.paths import PLAYWRIGHT_BROWSERS_PATH

logger = get_logger(__name__)

BROWSER = "chromium"

# playwright emits its download progress bars using carriage returns, so split on both.


async def _chromium_executable_path() -> Path:
    async with async_playwright() as playwright:
        return Path(playwright.chromium.executable_path)


async def _stream_install_output(stream: asyncio.StreamReader) -> str:
    _line_separators = re.compile(rb"[\r\n]")

    collected_lines = []
    buffer = b""
    while True:
        chunk = await stream.read(256)
        if not chunk:
            break
        buffer += chunk
        *complete, buffer = _line_separators.split(buffer)
        for part in complete:
            line = part.decode(errors="replace").strip()
            if line:
                logger.info(line)
                collected_lines.append(line)
    line = buffer.decode(errors="replace").strip()
    if line:
        logger.info(line)
        collected_lines.append(line)
    return "\n".join(collected_lines)


async def _download_chromium() -> None:
    command = [sys.executable, "-m", "playwright", "install", BROWSER]
    process = await asyncio.create_subprocess_exec(
        *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    assert process.stdout is not None
    output = await _stream_install_output(process.stdout)
    await process.wait()
    if process.returncode != 0:
        raise RuntimeError(f"`playwright install {BROWSER}` failed (exit code {process.returncode}):\n{output}")


async def ensure_chromium_installed() -> None:
    executable_path = await _chromium_executable_path()
    if executable_path.exists():
        logger.debug(f"Playwright {BROWSER} browser already present at {executable_path}")
        return

    logger.info(
        f"Playwright {BROWSER} browser not found at {executable_path}; downloading it into "
        f"{PLAYWRIGHT_BROWSERS_PATH}. This happens once per version and may take a moment ..."
    )
    try:
        await _download_chromium()
    except Exception:
        logger.exception(f"Failed to download the Playwright {BROWSER} browser")
        return

    logger.info(f"Playwright {BROWSER} browser downloaded successfully")
