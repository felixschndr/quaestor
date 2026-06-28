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
    api_keys,
    auth,
    contracts,
    credentials,
    i18n,
    notification_rules,
    push,
    settings,
    statistics,
    transactions,
    users,
    version,
)
from source.backend.api.exception_handlers import register_exception_handlers
from source.backend.api.openapi import API_DESCRIPTION
from source.backend.constants import API_PREFIX
from source.backend.db import SessionLocal, close_engine, log_database_location
from source.backend.helpers import (
    get_backend_source_path,
    get_frontend_path,
    get_project_name,
    get_project_version,
)
from source.backend.logging_utils import (
    NO_SESSION_LOG_LABEL,
    SYSTEM_LOG_LABEL,
    get_logger,
    redact_headers,
    session_log_context,
    set_session_log_label,
)
from source.backend.security.csp import csp_middleware
from source.backend.security.csrf import csrf_middleware
from source.backend.security.rate_limit import rate_limit_middleware
from source.backend.services import (
    api_key_service,
    bank_info_updater,
    category_rescan,
    contract_detection_service,
    contract_overdue_scheduler,
    i18n_service,
    migrations,
    playwright_browser,
    recurring_transaction_scheduler,
    session_service,
    sync_scheduler,
)
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

logger = get_logger(__name__)

MAX_LOGGED_BODY_BYTES = 4096
ALLOW_MISSING_FRONTEND_ENV = "ALLOW_MISSING_FRONTEND"

LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [%(session)s] [%(name)s] %(message)s"

load_dotenv()


STARTUP_BACKGROUND_TASKS = (
    (bank_info_updater, "run_startup_update"),
    (category_rescan, "run_startup_rescan"),
    (contract_detection_service, "run_startup_detection"),
    (sync_scheduler, "run_periodic_sync"),
    (recurring_transaction_scheduler, "run_periodic_recurring"),
    (contract_overdue_scheduler, "run_periodic_overdue_check"),
)


async def _run_as_system_task(module: Any, name: str) -> None:
    with session_log_context(SYSTEM_LOG_LABEL):
        await getattr(module, name)()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    _route_third_party_loggers_to_root()
    i18n_service.validate_display_timezone()
    log_database_location()
    migrations.upgrade_to_head()

    await playwright_browser.ensure_chromium_installed()

    background_tasks = [
        asyncio.create_task(_run_as_system_task(module=module, name=name)) for module, name in STARTUP_BACKGROUND_TASKS
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
        format=LOG_FORMAT,
        encoding="utf-8",
        level=log_level,
        force=True,
    )
    for handler in logging.root.handlers:
        handler.addFilter(_RenameUvicornError())
    logger.debug(f"Logging configured at level {log_level}")


def log_startup_version() -> None:
    logger.info(f"Starting {get_project_name()} {get_project_version()}")


setup_logging()
log_startup_version()

app = FastAPI(
    title=get_project_name(),
    version=get_project_version(),
    description=API_DESCRIPTION,
    lifespan=lifespan,
    docs_url=None,
)

app.middleware("http")(csrf_middleware)
app.middleware("http")(csp_middleware)


@app.middleware("http")
async def refresh_session(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if not request.url.path.startswith(API_PREFIX):
        # Only the API ever needs the session cookie. Re-issuing it on static/SPA responses (served from "/") is
        # dangerous: those responses are cacheable, and a shared cache (e.g. nginx) would store one user's session
        # cookie alongside an asset and replay it to the next visitor.
        return await call_next(request)

    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    session_valid = False
    remember_me = False
    if raw_token:
        with SessionLocal() as db_session:
            user_session = session_service.renew_session(db_session=db_session, raw_token=raw_token)
            if user_session is not None:
                session_valid = True
                remember_me = user_session.remember_me
                set_session_log_label(user_session.log_label())
                request.state.session_log_label = user_session.log_label()
                logger.debug(f"[{request.method}] [{request.url.path}]: refreshed {user_session}")
    elif api_key_service.request_carries_api_key(request):
        with SessionLocal() as db_session:
            api_key_label = api_key_service.resolve_log_label(db_session=db_session, request=request)
        if api_key_label is not None:
            set_session_log_label(api_key_label)
            request.state.session_log_label = api_key_label

    response = await call_next(request)

    if raw_token and not session_valid:
        logger.debug(
            f"[{request.method}] [{request.url.path}]: presented session cookie is invalid or expired, "
            "clearing it from the response"
        )
        session_service.clear_session_cookie(response)
    elif session_valid:
        session_service.set_session_cookie(response=response, raw_token=raw_token, remember_me=remember_me)
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
    log_level_is_debug = logger.is_enabled_for(logging.DEBUG)

    request_body = b""
    if log_level_is_debug:
        try:
            request_body = await request.body()
        except Exception as e:
            logger.debug(f"Could not read request body for [{request.method}] [{request.url.path}]: {e}")
            request_body = b""

    response = await call_next(request)
    # Authentication runs downstream in its own context, so it can't set our contextvar directly;
    # it leaves the label on request.state for us to apply to the request summary line.
    set_session_log_label(getattr(request.state, "session_log_label", NO_SESSION_LOG_LABEL))
    summary = f"[{request.method}] [{request.url.path}] -> {response.status_code}"

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


@app.middleware("http")
async def prevent_caching_of_sensitive_responses(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    # API responses are per-user and must never be served from a shared cache to prevent session-bleed
    if request.url.path.startswith(API_PREFIX) or "set-cookie" in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


for api_object in [
    account,
    account_groups,
    api_keys,
    auth,
    contracts,
    credentials,
    i18n,
    notification_rules,
    push,
    settings,
    statistics,
    transactions,
    users,
    version,
]:
    app.include_router(api_object.router, prefix=API_PREFIX)
register_exception_handlers(app)


class _CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path=path, scope=scope)
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response


app.mount(path="/static", app=_CachedStaticFiles(directory=(get_backend_source_path() / "static")), name="static")


class _SpaStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            response = await super().get_response(path=path, scope=scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            response = await super().get_response(path="index.html", scope=scope)
            path = "index.html"

        if path.startswith("assets/") or "/assets/" in path:
            # Content-hashed bundles under assets/ change name on every build, so they are safe to cache forever.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


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


_FRONTEND_DIST = resolve_frontend_dist(get_frontend_path() / "dist")
if _FRONTEND_DIST is not None:
    app.mount(path="/", app=_SpaStaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
    logger.info(f"Serving SPA from {_FRONTEND_DIST}")
