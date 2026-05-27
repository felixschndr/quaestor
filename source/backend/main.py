import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any, AsyncGenerator, Awaitable, Callable

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from source.backend.api import (
    account,
    account_groups,
    auth,
    credentials,
    i18n,
    transactions,
    users,
)
from source.backend.api.exception_handlers import register_exception_handlers
from source.backend.constants import API_PREFIX
from source.backend.db import SessionLocal, close_engine, log_database_location
from source.backend.helpers import get_backend_source_path, get_frontend_source_path
from source.backend.logging_utils import get_logger, redact_headers
from source.backend.security.csp import csp_middleware
from source.backend.security.csrf import csrf_middleware
from source.backend.security.rate_limit import rate_limit_middleware
from source.backend.services import (
    category_rescan,
    migrations,
    session_service,
    sync_scheduler,
)
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

logger = get_logger(__name__)

MAX_LOGGED_BODY_BYTES = 4096
ALLOW_MISSING_FRONTEND_ENV = "ALLOW_MISSING_FRONTEND"

load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    _route_third_party_loggers_to_root()
    log_database_location()
    migrations.upgrade_to_head()

    background_tasks = [
        asyncio.create_task(category_rescan.run_startup_rescan()),
        asyncio.create_task(sync_scheduler.run_periodic_sync()),
    ]
    try:
        yield
    finally:
        for task in background_tasks:
            task.cancel()
        for task in background_tasks:
            with suppress(asyncio.CancelledError):
                await task
        close_engine()
        logger.info("Shutdown complete")


class _RenameUvicornError(logging.Filter):
    """
    Rename uvicorn logs for all non-access messages from `uvicorn.error` to `uvicorn`
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == "uvicorn.error":
            record.name = "uvicorn"
        return True


def _route_third_party_loggers_to_root() -> None:
    for name in logging.root.manager.loggerDict:
        if name.startswith("uvicorn"):
            third_party_logger = logging.getLogger(name)
            third_party_logger.handlers.clear()
            # The log_requests middleware logs every request itself, so the
            # uvicorn access log would only be a duplicate.
            if name == "uvicorn.access":
                third_party_logger.disabled = True
                third_party_logger.propagate = False
            else:
                third_party_logger.propagate = True


def setup_logging() -> None:
    log_level = os.environ.get(key="LOG_LEVEL", default="INFO")
    logging.basicConfig(
        stream=sys.stdout,
        format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s",
        encoding="utf-8",
        level=log_level,
        force=True,
    )
    for handler in logging.root.handlers:
        handler.addFilter(_RenameUvicornError())
    logger.debug(f"Logging configured at level {log_level}")


setup_logging()

app = FastAPI(title="Finanzguru Clone", lifespan=lifespan)

app.middleware("http")(csrf_middleware)
app.middleware("http")(csp_middleware)


@app.middleware("http")
async def refresh_session(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    if not raw_token:
        logger.debug(f"{request.method} {request.url.path}: no session cookie, skipping session refresh")
        return response
    with SessionLocal() as db_session:
        user_session = session_service.renew_session(db_session=db_session, raw_token=raw_token)
        if user_session is None:
            logger.debug(
                f"{request.method} {request.url.path}: presented session cookie is invalid or expired, "
                "clearing it from the response"
            )
            session_service.clear_session_cookie(response)
        else:
            logger.debug(f"{request.method} {request.url.path}: refreshed {user_session}")
            session_service.set_session_cookie(
                response=response, raw_token=raw_token, remember_me=user_session.remember_me
            )
    return response


def _loggable_json_body(raw: bytes, content_type: str) -> Any:
    if not raw or "application/json" not in content_type or len(raw) > MAX_LOGGED_BODY_BYTES:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


app.middleware("http")(rate_limit_middleware)


@app.middleware("http")
async def log_http_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    log_level_is_debug = logging.getLogger(__name__).isEnabledFor(logging.DEBUG)

    request_body = b""
    if log_level_is_debug:
        try:
            request_body = await request.body()
        except Exception as e:
            logger.debug(f"Could not read request body for {request.method} {request.url.path}: {e}")
            request_body = b""

    response = await call_next(request)
    summary = f"{request.method} {request.url.path} -> {response.status_code}"

    if response.status_code >= 500:
        log_method = logger.error
    elif response.status_code >= 400:
        log_method = logger.warning
    else:
        log_method = logger.info

    if not log_level_is_debug:
        log_method(summary)
        return response

    response_body = b"".join([chunk async for chunk in response.body_iterator])
    rebuilt = Response(content=response_body, status_code=response.status_code, media_type=response.media_type)
    rebuilt.raw_headers = response.raw_headers

    extra = {
        "request": {
            "query": dict(request.query_params),
            "headers": redact_headers(dict(request.headers)),
            "body": _loggable_json_body(
                raw=request_body, content_type=request.headers.get(key="content-type", default="")
            ),
        },
        "response": {
            "headers": redact_headers(dict(response.headers)),
            "body": _loggable_json_body(
                raw=response_body, content_type=response.headers.get(key="content-type", default="")
            ),
        },
    }
    log_method(summary, extra=extra)
    return rebuilt


for api_object in [account, account_groups, auth, credentials, i18n, transactions, users]:
    app.include_router(api_object.router, prefix=API_PREFIX)
register_exception_handlers(app)

app.mount(path="/static", app=StaticFiles(directory=(get_backend_source_path() / "static")), name="static")


class _SpaStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path=path, scope=scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise

        return await super().get_response(path="index.html", scope=scope)


def resolve_frontend_dist(dist_path: Path) -> Path | None:
    if dist_path.is_dir():
        return dist_path

    allow_missing = os.environ.get(key=ALLOW_MISSING_FRONTEND_ENV, default="false").lower() == "true"
    if allow_missing:
        logger.info(f"Frontend dist not found at {dist_path}; SPA not served ({ALLOW_MISSING_FRONTEND_ENV}=true).")
        return None

    raise RuntimeError(
        f"Frontend dist not found at {dist_path}. "
        f"Run `pnpm -C source/frontend build` (or `task run:prod`) first, "
        f"or set {ALLOW_MISSING_FRONTEND_ENV}=true to run the backend without a built frontend."
    )


_FRONTEND_DIST = resolve_frontend_dist(get_frontend_source_path() / "dist")
if _FRONTEND_DIST is not None:
    app.mount(path="/", app=_SpaStaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
    logger.info(f"Serving SPA from {_FRONTEND_DIST}")
